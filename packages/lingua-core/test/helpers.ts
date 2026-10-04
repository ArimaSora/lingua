import { DatabaseSync } from "node:sqlite";
import { FakeClock, migrate, openDatabase, openEventStore } from "../src/index";

export const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function makeHarness(start: number = T0) {
  const db = openDatabase(":memory:");
  migrate(db);
  const clock = new FakeClock(start);
  const store = openEventStore({ db, clock });
  return { db, clock, store };
}

export function insertChunk(
  db: DatabaseSync,
  id: string,
  options: {
    language?: string;
    createdAt?: number;
    form?: string;
    variants?: string[];
    sourceContentId?: string;
  } = {},
): void {
  db.prepare(
    `INSERT INTO chunks (id, language, canonical_form, chunk_type, cefr, variants, source_content_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.language ?? "en",
    options.form ?? `chunk ${id}`,
    "collocation",
    "A1",
    JSON.stringify(options.variants ?? []),
    options.sourceContentId ?? null,
    "enrolled",
    options.createdAt ?? T0,
  );
}

export function insertFact(
  db: DatabaseSync,
  id: string,
  options: { fact?: string; language?: string; createdAt?: number } = {},
): void {
  const language = options.language ?? "en";
  // 每语言一张角色卡：card_id 带语言后缀，避免跨语言事实挂到同一卡片。
  db.prepare(
    `INSERT INTO character_cards (id, language, name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  ).run(`card-${language}`, language, "Test Card", T0);
  db.prepare(
    `INSERT INTO relationship_facts (id, language, card_id, fact, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, language, `card-${language}`, options.fact ?? `fact ${id}`, options.createdAt ?? T0);
}

export function insertContent(
  db: DatabaseSync,
  id: string,
  options: { language?: string; body?: string; createdAt?: number } = {},
): void {
  db.prepare(
    `INSERT INTO content_items (id, language, body, status, created_at)
     VALUES (?, ?, ?, 'inbox', ?)`,
  ).run(id, options.language ?? "en", options.body ?? "", options.createdAt ?? T0);
}

export function insertAmbushTopic(
  db: DatabaseSync,
  id: string,
  options: {
    language?: string;
    status?: "open" | "resolved" | "stale";
    openedAt?: number;
    closedAt?: number | null;
  } = {},
): void {
  db.prepare(
    `INSERT INTO ambush_topics (id, language, status, topic_text, prompt, opened_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.language ?? "en",
    options.status ?? "open",
    `topic text ${id}`,
    `prompt ${id}`,
    options.openedAt ?? T0,
    options.closedAt ?? null,
  );
}

export function insertAmbushPlacement(
  db: DatabaseSync,
  id: string,
  options: {
    language?: string;
    topicId?: string;
    chunkId: string;
    buriedAt?: number;
    resolvedAt?: number | null;
    outcome?: "hit" | "missed" | null;
  },
): void {
  db.prepare(
    `INSERT INTO ambush_placements (id, language, topic_id, chunk_id, buried_at, resolved_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.language ?? "en",
    options.topicId ?? "topic-1",
    options.chunkId,
    options.buriedAt ?? T0,
    options.resolvedAt ?? null,
    options.outcome ?? null,
  );
}

export function insertLesson(
  db: DatabaseSync,
  id: string,
  options: { language?: string; title?: string; hook?: string } = {},
): void {
  db.prepare(
    `INSERT INTO bootstrap_lessons (id, language, pack_id, seq, title, kind, hook, body, chunks, created_at)
     VALUES (?, ?, 'pack-1', 1, ?, 'survival-chunks', ?, '', '[]', ?)`,
  ).run(
    id,
    options.language ?? "en",
    options.title ?? `lesson ${id}`,
    options.hook ?? `hook ${id}`,
    T0,
  );
}
