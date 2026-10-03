import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "./clock";
import { openDatabase } from "./database";

// SQLite 定时备份 = 复制数据库文件 + 保留策略（docs/specs/mvp.md 架构）。
// 纯逻辑模块：给定路径、策略与时钟即执行复制与剪枝；
// 调度由票 06 的调度器负责，本模块只暴露 runBackup 作为被调入口。

export interface BackupOptions {
  /** SQLite 主文件路径（如 ~/.lingua/lingua.db） */
  sourcePath: string;
  /** 备份目录，不存在时自动创建 */
  backupDir: string;
  /** 保留最近 N 份备份，超出者删除 */
  keepLast: number;
  clock: Clock;
}

export interface BackupResult {
  /** 本次生成的备份文件路径 */
  backupPath: string;
  /** 本次按保留策略删除的旧备份路径（旧→新） */
  prunedPaths: string[];
}

// 备份文件名含 ISO 时间戳（冒号与点替换为连字符，Windows 文件名合法），
// 字典序即时间序，供剪枝排序使用。
function backupFileName(ms: number): string {
  return `lingua-${new Date(ms).toISOString().replace(/[:.]/g, "-")}.db`;
}

// 只认本模块生成的时间戳备份名，避免误删用户放在同目录的其他文件。
const BACKUP_NAME = /^lingua-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*\.db$/;

function prune(backupDir: string, keepLast: number): string[] {
  const backups = readdirSync(backupDir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .reverse();
  const prunedPaths = backups.slice(keepLast).map((name) => join(backupDir, name));
  for (const path of prunedPaths) {
    unlinkSync(path);
  }
  return prunedPaths;
}

// 复制前先把 WAL 折回主文件：openDatabase 使用 WAL 模式，直接复制主文件
// 会丢掉尚未 checkpoint 的写入。TRUNCATE 等到读端结束后截断 -wal，
// busy≠0 说明源库被写事务占用，宁可失败也不生成缺数据的备份。
function checkpointSource(sourcePath: string): void {
  const db = openDatabase(sourcePath);
  try {
    const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as
      | { busy: number }
      | undefined;
    if (row && row.busy !== 0) {
      throw new Error(`备份失败：源数据库正被占用，checkpoint 未完成：${sourcePath}`);
    }
  } finally {
    db.close();
  }
}

export function runBackup(options: BackupOptions): BackupResult {
  const { sourcePath, backupDir, keepLast, clock } = options;
  if (!existsSync(sourcePath)) {
    throw new Error(`源数据库不存在：${sourcePath}`);
  }
  if (!Number.isInteger(keepLast) || keepLast < 1) {
    throw new RangeError(`keepLast 必须是 ≥1 的整数，收到：${keepLast}`);
  }
  checkpointSource(sourcePath);
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, backupFileName(clock.now()));
  copyFileSync(sourcePath, backupPath);
  return { backupPath, prunedPaths: prune(backupDir, keepLast) };
}

export interface RestoreOptions {
  /** 要恢复的备份文件 */
  backupPath: string;
  /** 恢复到的目标路径；必须不存在，避免覆盖在用数据库 */
  targetPath: string;
}

export function restoreBackup(options: RestoreOptions): string {
  const { backupPath, targetPath } = options;
  if (!existsSync(backupPath)) {
    throw new Error(`备份文件不存在：${backupPath}`);
  }
  if (existsSync(targetPath)) {
    throw new Error(`恢复目标已存在：${targetPath}（先移走现有数据库再恢复）`);
  }
  copyFileSync(backupPath, targetPath);
  return targetPath;
}
