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
  options: { language?: string; createdAt?: number } = {},
): void {
  db.prepare(
    `INSERT INTO chunks (id, language, canonical_form, chunk_type, cefr, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.language ?? "en",
    `chunk ${id}`,
    "collocation",
    "A1",
    "enrolled",
    options.createdAt ?? T0,
  );
}
