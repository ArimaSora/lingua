import { describe, expect, it } from "vitest";
import { migrate, openDatabase, SCHEMA_VERSION } from "../src/index";

describe("schema v1", () => {
  it("creates all v1 tables", () => {
    const db = openDatabase(":memory:");
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "character_cards",
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

  it("records the schema version and is idempotent", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    migrate(db);

    const versions = db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version);

    expect(versions).toEqual([SCHEMA_VERSION]);
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
});
