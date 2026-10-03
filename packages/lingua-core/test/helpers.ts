import { DatabaseSync } from "node:sqlite";
import { FakeClock, migrate, openDatabase, openEventStore } from "../src/index";

export const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
export const HOUR = 60 * 60 * 1000;
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
  options: { language?: string; createdAt?: number; form?: string } = {},
): void {
  db.prepare(
    `INSERT INTO chunks (id, language, canonical_form, chunk_type, cefr, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.language ?? "en",
    options.form ?? `chunk ${id}`,
    "collocation",
    "A1",
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
