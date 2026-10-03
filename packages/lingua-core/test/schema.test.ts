import { describe, expect, it } from "vitest";
import { MIGRATION_VERSIONS, migrate, openDatabase, SCHEMA_VERSION } from "../src/index";

describe("schema", () => {
  it("creates all tables", () => {
    const db = openDatabase(":memory:");
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    // 超集断言：并发票据各自新增自己的迁移与表（如票 06 的 v5、票 12 的 v6），
    // 本列表只保证本分支已知的表都存在，合并后新增表不应使本测试变红。
    expect(tables).toEqual(
      expect.arrayContaining([
        "admission_accounts",
        "character_cards",
        "chunk_occurrences",
        "chunks",
        "content_items",
        "error_logs",
        "events",
        "explanation_refs",
        "feeds",
        "learner_profiles",
        "messages",
        "metric_events",
        "param_snapshots",
        "relationship_facts",
        "schema_migrations",
      ]),
    );
  });

  it("records every schema version and is idempotent", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    migrate(db);

    const versions = db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version);

    // 迁移版本号不必连续（并发票据各占位：v5 归票 06，v6 归票 12），
    // 断言与 MIGRATIONS 实际登记的一致，合并分支后自动涵盖对方版本。
    expect(versions).toEqual([...MIGRATION_VERSIONS].sort((a, b) => a - b));
    expect(Math.max(...MIGRATION_VERSIONS)).toBe(SCHEMA_VERSION);
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
