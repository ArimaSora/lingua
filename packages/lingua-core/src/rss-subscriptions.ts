import type { Clock } from "./clock";
import type { Database } from "./database";
import type { IngestResult, ContentPipeline, IngestProvidedInput } from "./content-pipeline";
import type { ChatMessage, MessageStore } from "./message-store";
import type { SchedulerTask } from "./scheduler";

// RSS 订阅管理（issue #11）：系统会话内增删源、轮询抓取与去重、
// 新条目走票 10 难度管道与统一推送路径。音频带文字稿时文字稿进管道，
// 推送内嵌极简播放器；无文字稿音频明确不支持。

export type FeedKind = "rss" | "podcast";

export type RssEntry = {
  id: string;
  url: string;
  title?: string | undefined;
  publishedAt?: number | undefined;
  body?: string | undefined;
  audioUrl?: string | undefined;
  transcript?: string | undefined;
};

export type RssFetcher = (url: string) => string | Promise<string>;

export type RssParser = (xml: string, feedUrl: string) => RssEntry[];

export type StoredFeed = {
  id: string;
  url: string;
  title?: string | undefined;
  kind: FeedKind;
  createdAt: number;
  lastFetchedAt?: number | undefined;
  fetchIntervalMs?: number | undefined;
};

export type RssPollReport = {
  pushed: { entry: RssEntry; result: IngestResult; message?: ChatMessage }[];
  unsupported: RssEntry[];
};

export type RssSubscriptionsOptions = {
  db: Database;
  clock: Clock;
  language: string;
  pipeline: ContentPipeline;
  messageStore: MessageStore;
  fetcher: RssFetcher;
  parser?: RssParser;
  userId?: string;
  defaultIntervalMs?: number;
};

export type RssSubscriptions = {
  addFeed(input: { url: string; kind?: FeedKind; title?: string }): StoredFeed;
  removeFeed(id: string): boolean;
  listFeeds(): StoredFeed[];
  poll(now?: number): Promise<RssPollReport>;
  createSchedulerTask(options?: { intervalMs?: number }): SchedulerTask;
};

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const TASK_ID = "rss-poll";

function htmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1");
}

function normalizeText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return htmlUnescape(stripCdata(text).trim()) || undefined;
}

function extractTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "is");
  const match = re.exec(xml);
  return match ? normalizeText(match[1]) : undefined;
}

function extractDate(xml: string, tag: string): number | undefined {
  const raw = extractTag(xml, tag);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseRssFeed(xml: string, feedUrl: string): RssEntry[] {
  const items: RssEntry[] = [];
  const itemRe = /<item[^>]*>(.*?)<\/item>/gis;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRe.exec(xml)) !== null) {
    const itemXml = itemMatch[1]!;
    const url = extractTag(itemXml, "link");
    const guid = extractTag(itemXml, "guid");
    const id = guid ?? url;
    if (!id || !url) continue;

    const title = extractTag(itemXml, "title");
    const publishedAt = extractDate(itemXml, "pubDate");
    const description = extractTag(itemXml, "description");
    const transcript = extractTag(itemXml, "transcript");

    const enclosureMatch = /<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']audio\/[^"']*["'][^>]*\/?>/i.exec(
      itemXml,
    );
    const audioUrl = enclosureMatch ? normalizeText(enclosureMatch[1]) : undefined;

    const body = transcript ?? description;

    items.push({
      id,
      url,
      title,
      publishedAt,
      body,
      audioUrl,
      transcript,
    });
  }

  // Atom 兜底：entry + link[@href]
  if (items.length === 0) {
    const entryRe = /<entry[^>]*>(.*?)<\/entry>/gis;
    let entryMatch: RegExpExecArray | null;
    while ((entryMatch = entryRe.exec(xml)) !== null) {
      const entryXml = entryMatch[1]!;
      const linkMatch = /<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i.exec(entryXml);
      const url = linkMatch ? normalizeText(linkMatch[1]) : undefined;
      const id = extractTag(entryXml, "id") ?? url;
      if (!id || !url) continue;

      const title = extractTag(entryXml, "title");
      const publishedAt = extractDate(entryXml, "published") ?? extractDate(entryXml, "updated");
      const summary = extractTag(entryXml, "summary");
      const content = extractTag(entryXml, "content");
      const transcript = extractTag(entryXml, "transcript");
      const enclosureMatch = /<link[^>]+rel=["']enclosure["'][^>]+href=["']([^"']+)["'][^>]*\/?>/i.exec(
        entryXml,
      );
      const audioUrl = enclosureMatch ? normalizeText(enclosureMatch[1]) : undefined;
      const body = transcript ?? content ?? summary;

      items.push({ id, url, title, publishedAt, body, audioUrl, transcript });
    }
  }

  return items;
}

function formatRssPush(params: {
  title?: string | undefined;
  sourceUrl: string;
  audioUrl?: string | undefined;
  result: IngestResult;
}): string {
  const { title, sourceUrl, audioUrl, result } = params;
  const headline = title ?? "订阅更新";

  if (result.kind === "simplified" && result.simplified) {
    return [
      `【订阅更新·简化版】${result.simplified.title}`,
      `原文难度约 ${result.level}，已为你生成简化版。`,
      result.simplified.body,
      audioUrl ? `<audio src="${audioUrl}" controls></audio>` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (result.kind === "unlock_queued") {
    return `【订阅更新】${headline}\n已收入解锁队列，${result.unlockLabel ?? `原文难度约 ${result.level}`}。\n原文链接：${sourceUrl}`;
  }

  return [
    `【订阅更新】${headline}`,
    `原文链接：${sourceUrl}`,
    audioUrl ? `<audio src="${audioUrl}" controls></audio>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function openRssSubscriptions(options: RssSubscriptionsOptions): RssSubscriptions {
  const { db, clock, language, pipeline, messageStore, fetcher, parser = parseRssFeed } = options;
  const userId = options.userId ?? "local";
  const defaultIntervalMs = options.defaultIntervalMs ?? DEFAULT_INTERVAL_MS;

  const insertFeed = db.prepare(
    `INSERT INTO feeds (id, user_id, language, url, title, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteFeed = db.prepare(
    "DELETE FROM feeds WHERE id = ? AND user_id = ? AND language = ?",
  );
  const list = db.prepare(
    "SELECT id, url, title, kind, created_at, last_fetched_at, fetch_interval_ms FROM feeds WHERE user_id = ? AND language = ? ORDER BY created_at, id",
  );
  const updateFetched = db.prepare(
    "UPDATE feeds SET last_fetched_at = ?, fetch_interval_ms = ? WHERE id = ? AND user_id = ? AND language = ?",
  );
  const existsContent = db.prepare(
    "SELECT id FROM content_items WHERE feed_id = ? AND source_url = ? LIMIT 1",
  );
  const insertUnsupported = db.prepare(
    `INSERT INTO content_items (
       id, user_id, language, feed_id, source_url, title, body,
       pipeline_status, audio_url, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'dismissed', ?, ?)`,
  );

  function rowToFeed(row: {
    id: string;
    url: string;
    title: string | null;
    kind: string;
    created_at: number;
    last_fetched_at: number | null;
    fetch_interval_ms: number | null;
  }): StoredFeed {
    return {
      id: row.id,
      url: row.url,
      title: row.title ?? undefined,
      kind: row.kind as FeedKind,
      createdAt: row.created_at,
      lastFetchedAt: row.last_fetched_at ?? undefined,
      fetchIntervalMs: row.fetch_interval_ms ?? undefined,
    };
  }

  function addFeed(input: { url: string; kind?: FeedKind; title?: string }): StoredFeed {
    const id = clock.newId();
    const kind = input.kind ?? "rss";
    const createdAt = clock.now();
    insertFeed.run(id, userId, language, input.url, input.title ?? null, kind, createdAt);
    return {
      id,
      url: input.url,
      title: input.title,
      kind,
      createdAt,
    };
  }

  function removeFeed(id: string): boolean {
    const result = deleteFeed.run(id, userId, language);
    return (result.changes ?? 0) > 0;
  }

  function listFeeds(): StoredFeed[] {
    return (list.all(userId, language) as unknown as {
      id: string;
      url: string;
      title: string | null;
      kind: string;
      created_at: number;
      last_fetched_at: number | null;
      fetch_interval_ms: number | null;
    }[]).map(rowToFeed);
  }

  async function poll(now?: number): Promise<RssPollReport> {
    const t = now ?? clock.now();
    const report: RssPollReport = { pushed: [], unsupported: [] };
    const feeds = listFeeds();

    for (const feed of feeds) {
      updateFetched.run(t, feed.fetchIntervalMs ?? defaultIntervalMs, feed.id, userId, language);

      let xml: string;
      try {
        xml = await fetcher(feed.url);
      } catch {
        continue;
      }
      const entries = parser(xml, feed.url);

      for (const entry of entries) {
        const existing = existsContent.get(feed.id, entry.url) as { id: string } | undefined;
        if (existing) continue;

        if (entry.audioUrl && !entry.transcript) {
          report.unsupported.push(entry);
          insertUnsupported.run(
            clock.newId(),
            userId,
            language,
            feed.id,
            entry.url,
            entry.title ?? null,
            "",
            entry.audioUrl ?? null,
            clock.now(),
          );
          continue;
        }

        const body = entry.body ?? entry.title ?? "";
        const ingestInput: IngestProvidedInput = {
          title: entry.title,
          body,
          sourceUrl: entry.url,
          publishedAt: entry.publishedAt,
          feedId: feed.id,
          audioUrl: entry.audioUrl,
        };
        const result = await pipeline.ingestProvided(ingestInput);
        const message = messageStore.append({
          language,
          contact: "system",
          role: "assistant",
          text: formatRssPush({
            title: entry.title,
            sourceUrl: entry.url,
            audioUrl: entry.audioUrl,
            result,
          }),
        });
        report.pushed.push({ entry, result, message });
      }
    }

    return report;
  }

  function createSchedulerTask(taskOptions?: { intervalMs?: number }): SchedulerTask {
    return {
      id: TASK_ID,
      intervalMs: taskOptions?.intervalMs ?? defaultIntervalMs,
      run: (now: number) => {
        void poll(now);
      },
    };
  }

  return { addFeed, removeFeed, listFeeds, poll, createSchedulerTask };
}
