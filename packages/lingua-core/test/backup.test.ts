import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock, migrate, openDatabase, restoreBackup, runBackup } from "../src/index";
import { HOUR, insertChunk, T0 } from "./helpers";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lingua-backup-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeSourceDb(): string {
  const sourcePath = join(dir, "lingua.db");
  const db = openDatabase(sourcePath);
  migrate(db);
  insertChunk(db, "c1");
  db.close();
  return sourcePath;
}

describe("runBackup", () => {
  it("copies the database to a timestamped file whose data is intact", () => {
    const sourcePath = makeSourceDb();
    const clock = new FakeClock(T0);

    const result = runBackup({
      sourcePath,
      backupDir: join(dir, "backups"),
      keepLast: 7,
      clock,
    });

    expect(result.backupPath).toBe(join(dir, "backups", "lingua-2026-01-01T09-00-00-000Z.db"));
    const restored = openDatabase(result.backupPath);
    const rows = restored.prepare("SELECT id FROM chunks").all();
    restored.close();
    expect(rows).toEqual([{ id: "c1" }]);
  });

  it("captures data still sitting in the WAL while the source stays open", () => {
    const sourcePath = join(dir, "lingua.db");
    const db = openDatabase(sourcePath);
    migrate(db);
    insertChunk(db, "c1");

    const { backupPath } = runBackup({
      sourcePath,
      backupDir: join(dir, "backups"),
      keepLast: 7,
      clock: new FakeClock(T0),
    });
    db.close();

    const restored = openDatabase(backupPath);
    const rows = restored.prepare("SELECT id FROM chunks").all();
    restored.close();
    expect(rows).toEqual([{ id: "c1" }]);
  });
});

describe("restoreBackup", () => {
  it("restores a backup to a new location with data intact", () => {
    const sourcePath = makeSourceDb();
    const { backupPath } = runBackup({
      sourcePath,
      backupDir: join(dir, "backups"),
      keepLast: 7,
      clock: new FakeClock(T0),
    });

    const targetPath = join(dir, "restored.db");
    restoreBackup({ backupPath, targetPath });

    const db = openDatabase(targetPath);
    const rows = db.prepare("SELECT id FROM chunks").all();
    db.close();
    expect(rows).toEqual([{ id: "c1" }]);
  });

  it("refuses to overwrite an existing target", () => {
    const sourcePath = makeSourceDb();
    const { backupPath } = runBackup({
      sourcePath,
      backupDir: join(dir, "backups"),
      keepLast: 7,
      clock: new FakeClock(T0),
    });

    expect(() => restoreBackup({ backupPath, targetPath: sourcePath })).toThrow(/已存在/);
  });

  it("refuses a missing backup file", () => {
    expect(() =>
      restoreBackup({
        backupPath: join(dir, "nope.db"),
        targetPath: join(dir, "restored.db"),
      }),
    ).toThrow(/备份文件不存在/);
  });
});

describe("runBackup 保留策略", () => {
  it("keeps only the newest keepLast backups and leaves non-backup files alone", () => {
    const sourcePath = makeSourceDb();
    const backupDir = join(dir, "backups");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, "lingua.db"), "not a backup");
    writeFileSync(join(backupDir, "notes.txt"), "not a backup");

    const clock = new FakeClock(T0);
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(runBackup({ sourcePath, backupDir, keepLast: 3, clock }));
      clock.advance(HOUR);
    }

    expect(results[3]!.prunedPaths).toEqual([join(backupDir, "lingua-2026-01-01T09-00-00-000Z.db")]);
    expect(results[4]!.prunedPaths).toEqual([join(backupDir, "lingua-2026-01-01T10-00-00-000Z.db")]);
    expect(readdirSync(backupDir).sort()).toEqual([
      "lingua-2026-01-01T11-00-00-000Z.db",
      "lingua-2026-01-01T12-00-00-000Z.db",
      "lingua-2026-01-01T13-00-00-000Z.db",
      "lingua.db",
      "notes.txt",
    ]);
  });
});

describe("runBackup 参数校验", () => {
  it("refuses a missing source database without creating one", () => {
    const sourcePath = join(dir, "nope.db");
    expect(() =>
      runBackup({
        sourcePath,
        backupDir: join(dir, "backups"),
        keepLast: 7,
        clock: new FakeClock(T0),
      }),
    ).toThrow(/源数据库不存在/);
    expect(existsSync(sourcePath)).toBe(false);
  });

  it("rejects keepLast below 1", () => {
    const sourcePath = makeSourceDb();
    expect(() =>
      runBackup({
        sourcePath,
        backupDir: join(dir, "backups"),
        keepLast: 0,
        clock: new FakeClock(T0),
      }),
    ).toThrow(/keepLast/);
  });
});
