import { describe, expect, it } from "vitest";
import {
  openDatabase,
  migrate,
  FakeClock,
  openContentPipeline,
  openMessageStore,
  openScheduler,
} from "../src/index";
import { openRssSubscriptions, parseRssFeed } from "../src/rss-subscriptions";
import type { Cefr } from "../src/bootstrap-pack";
import type { Wordlist } from "../src/difficulty";

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);

const WORDS: Record<string, Cefr> = {
  the: "A1",
  cat: "A1",
  dog: "A1",
  fish: "A1",
  bird: "A1",
  be: "A1",
  big: "A1",
  small: "A1",
  good: "A1",
  red: "A1",
  blue: "A1",
  and: "A1",
  i: "A1",
  like: "A1",
  village: "A2",
  river: "A2",
  however: "B1",
  government: "B1",
  increase: "B1",
  substantial: "B2",
  ubiquitous: "C1",
};

function fakeWordlist(): Wordlist {
  return { lookup: (lemma) => WORDS[lemma] ?? null };
}

function makePipeline(db: ReturnType<typeof openDatabase>, clock: FakeClock) {
  return openContentPipeline({
    db,
    clock,
    language: "en",
    extractor: async () => ({ title: "x", body: "x" }),
    simplifier: async ({ body, url }) => ({
      title: "简化版",
      body: `[简化版] ${body}\n原文链接：${url}`,
    }),
    wordlist: fakeWordlist(),
  });
}

function fixtureXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Agent Essay</title>
      <link>https://example.com/essay</link>
      <guid>essay-1</guid>
      <pubDate>Thu, 01 Jan 2026 09:00:00 GMT</pubDate>
      <description>The cat is big. I like the cat.</description>
    </item>
    <item>
      <title>Podcast with Transcript</title>
      <link>https://example.com/pod/1</link>
      <guid>pod-1</guid>
      <pubDate>Thu, 01 Jan 2026 09:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/pod1.mp3" type="audio/mpeg" />
      <transcript>The dog is small. I like the dog.</transcript>
    </item>
    <item>
      <title>Podcast without Transcript</title>
      <link>https://example.com/pod/2</link>
      <guid>pod-2</guid>
      <pubDate>Thu, 01 Jan 2026 09:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/pod2.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>`;
}

function setup(feedXml = fixtureXml()) {
  const db = openDatabase(":memory:");
  migrate(db);
  const clock = new FakeClock(T0);
  const pipeline = makePipeline(db, clock);
  const messages = openMessageStore({ db, clock });
  const rss = openRssSubscriptions({
    db,
    clock,
    language: "en",
    pipeline,
    messageStore: messages,
    fetcher: async () => feedXml,
    parser: parseRssFeed,
  });
  return { db, clock, pipeline, messages, rss };
}

describe("RSS 订阅管理", () => {
  it("添加、列出与删除订阅源", () => {
    const { rss } = setup();

    const added = rss.addFeed({ url: "https://example.com/feed.xml", kind: "rss" });
    expect(added.url).toBe("https://example.com/feed.xml");
    expect(added.kind).toBe("rss");

    const feeds = rss.listFeeds();
    expect(feeds).toHaveLength(1);
    expect(feeds[0]!.url).toBe("https://example.com/feed.xml");

    expect(rss.removeFeed(added.id)).toBe(true);
    expect(rss.listFeeds()).toHaveLength(0);
    expect(rss.removeFeed(added.id)).toBe(false);
  });

  it("轮询新条目进入内容管道并按难度推送", async () => {
    const { rss, messages } = setup();
    rss.addFeed({ url: "https://example.com/feed.xml", kind: "rss" });

    const report = await rss.poll();

    expect(report.pushed).toHaveLength(2);
    expect(report.pushed[0]!.entry.id).toBe("essay-1");
    expect(report.pushed[1]!.entry.id).toBe("pod-1");
    expect(report.unsupported).toHaveLength(1);
    expect(report.unsupported[0]!.id).toBe("pod-2");

    const systemMessages = messages.list({ language: "en", contact: "system" });
    expect(systemMessages).toHaveLength(2);
    expect(systemMessages[0]!.text).toMatch(/Agent Essay/);
    expect(systemMessages[1]!.text).toMatch(/Podcast with Transcript/);
  });

  it("重复轮询不产生重复条目与重复推送", async () => {
    const { rss, messages, db } = setup();
    rss.addFeed({ url: "https://example.com/feed.xml", kind: "rss" });

    await rss.poll();
    const second = await rss.poll();

    expect(second.pushed).toHaveLength(0);
    expect(second.unsupported).toHaveLength(0);
    expect(messages.list({ language: "en", contact: "system" })).toHaveLength(2);

    const rows = db
      .prepare("SELECT pipeline_status, COUNT(*) AS n FROM content_items WHERE feed_id IS NOT NULL GROUP BY pipeline_status")
      .all() as { pipeline_status: string; n: number }[];
    expect(rows.find((r) => r.pipeline_status === "inbox")?.n).toBe(2);
    expect(rows.find((r) => r.pipeline_status === "dismissed")?.n).toBe(1);
  });

  it("带文字稿音频的文字稿进管道，推送带极简播放器", async () => {
    const { rss, messages, db } = setup();
    const feed = rss.addFeed({ url: "https://example.com/feed.xml", kind: "podcast" });

    await rss.poll();

    const row = db
      .prepare("SELECT body, audio_url FROM content_items WHERE source_url = ?")
      .get("https://example.com/pod/1") as { body: string; audio_url: string | null };
    expect(row.body).toContain("The dog is small");
    expect(row.audio_url).toBe("https://cdn.example.com/pod1.mp3");

    const text = messages.list({ language: "en", contact: "system" }).find((m) =>
      m.text.includes("Podcast with Transcript"),
    )!.text;
    expect(text).toMatch(/<audio[^>]+src="https:\/\/cdn\.example\.com\/pod1\.mp3"[^>]*controls/);
  });

  it("无文字稿音频明确不支持，不进管道", async () => {
    const { rss, db, messages } = setup();
    rss.addFeed({ url: "https://example.com/feed.xml", kind: "podcast" });

    const report = await rss.poll();
    expect(report.unsupported.some((e) => e.id === "pod-2")).toBe(true);

    const row = db
      .prepare("SELECT pipeline_status FROM content_items WHERE source_url = ?")
      .get("https://example.com/pod/2") as { pipeline_status: string };
    expect(row.pipeline_status).toBe("dismissed");

    expect(messages.list({ language: "en", contact: "system" }).some((m) =>
      m.text.includes("Podcast without Transcript"),
    )).toBe(false);
  });

  it("注册为调度器任务后，假时钟驱动轮询并节流", () => {
    const { db, clock, pipeline, messages } = setup();
    const scheduler = openScheduler({ db, clock });
    const rss = openRssSubscriptions({
      db,
      clock,
      language: "en",
      pipeline,
      messageStore: messages,
      fetcher: () => fixtureXml(),
      parser: parseRssFeed,
    });
    rss.addFeed({ url: "https://example.com/feed.xml", kind: "rss" });

    const task = rss.createSchedulerTask({ intervalMs: 60 * 60 * 1000 });
    scheduler.registerTask(task);

    expect(scheduler.tick().ran).toContain("rss-poll");
    expect(rss.listFeeds()[0]!.lastFetchedAt).toBe(T0);

    clock.advance(30 * 60 * 1000);
    expect(scheduler.tick().ran).toEqual([]);

    clock.advance(31 * 60 * 1000);
    expect(scheduler.tick().ran).toContain("rss-poll");
  });
});
