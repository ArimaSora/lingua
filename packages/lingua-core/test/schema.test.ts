import { describe, expect, it } from "vitest";
import { migrate, openDatabase, SCHEMA_VERSION } from "../src/index";

describe("schema", () => {
  it("creates all tables", () => {
    const db = openDatabase(":memory:");
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "character_cards",
      "chunk_occurrences",
      "chunks",
      "content_items",
      "error_logs",
      "events",
      "feeds",
      "learner_profiles",
      "metric_events",
      "param_snapshots",
      "relationship_facts",
      "schema_migrations",
    ]);
  });

  it("records every schema version and is idempotent", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    migrate(db);

    const versions = db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version);

    expect(versions).toEqual([...Array(SCHEMA_VERSION).keys()].map((i) => i + 1));
  });

  it("isolates rows by language and reserves user_id", () => {
    const db = openDatabase(":memory:");
    migrate(db);

    const chunkColumns = db
      .prepare("PRAGMA table_info(chunks)")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(chunkColumns).toContain("user_id");
    expect(chunkColumns).toContain("language");
  });

  it("separates chunk occurrence records from the chunk entity (issue #2)", () => {
    const db = openDatabase(":memory:");
    migrate(db);

    const occurrenceColumns = db
      .prepare("PRAGMA table_info(chunk_occurrences)")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const column of [
      "chunk_id",
      "content_id",
      "start_token",
      "end_token",
      "surface",
      "user_id",
      "language",
    ]) {
      expect(occurrenceColumns).toContain(column);
    }
  });
});
