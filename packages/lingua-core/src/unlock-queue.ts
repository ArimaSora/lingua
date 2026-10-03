import type { Clock } from "./clock";
import type { Database } from "./database";
import type { Cefr } from "./bootstrap-pack";

// 解锁队列（ADR-0012）：把远超当前水平的常青内容暂存为进度钩子，
// 易腐内容因简化失败等意外入队时设过期时间，由调度器定期清理。

export type UnlockQueueItem = {
  contentId: string;
  title: string | null;
  sourceUrl: string | null;
  unlockLevel: Cefr;
  unlockLabel: string;
  perishability: "perishable" | "evergreen";
  expiresAt: number | null;
  createdAt: number;
};

export type UnlockQueueOptions = {
  db: Database;
  clock: Clock;
  userId?: string;
  language: string;
};

export type UnlockQueue = {
  add(contentId: string, options: { unlockLevel: Cefr; expiresAt?: number | null | undefined }): void;
  list(): UnlockQueueItem[];
  expireOld(now?: number): string[];
};

export function openUnlockQueue(options: UnlockQueueOptions): UnlockQueue {
  const { db, clock } = options;
  const userId = options.userId ?? "local";
  const language = options.language;

  const update = db.prepare(
    `UPDATE content_items
     SET pipeline_status = 'unlock_queued', unlock_level = ?, expires_at = ?
     WHERE id = ? AND user_id = ? AND language = ?`,
  );

  const select = db.prepare(
    `SELECT id, title, source_url, unlock_level, perishability, expires_at, created_at
     FROM content_items
     WHERE user_id = ? AND language = ? AND pipeline_status = 'unlock_queued'
     ORDER BY created_at, id`,
  );

  const remove = db.prepare(
    `DELETE FROM content_items
     WHERE user_id = ? AND language = ? AND pipeline_status = 'unlock_queued'
       AND perishability = 'perishable' AND expires_at IS NOT NULL AND expires_at < ?`,
  );

  const selectExpired = db.prepare(
    `SELECT id FROM content_items
     WHERE user_id = ? AND language = ? AND pipeline_status = 'unlock_queued'
       AND perishability = 'perishable' AND expires_at IS NOT NULL AND expires_at < ?`,
  );

  function add(contentId: string, addOptions: { unlockLevel: Cefr; expiresAt?: number }): void {
    update.run(addOptions.unlockLevel, addOptions.expiresAt ?? null, contentId, userId, language);
  }

  function list(): UnlockQueueItem[] {
    const rows = select.all(userId, language) as unknown as {
      id: string;
      title: string | null;
      source_url: string | null;
      unlock_level: Cefr;
      perishability: "perishable" | "evergreen";
      expires_at: number | null;
      created_at: number;
    }[];
    return rows.map((row) => ({
      contentId: row.id,
      title: row.title,
      sourceUrl: row.source_url,
      unlockLevel: row.unlock_level,
      unlockLabel: `原文难度约 ${row.unlock_level}`,
      perishability: row.perishability,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  function expireOld(now?: number): string[] {
    const t = now ?? clock.now();
    const expired = (selectExpired.all(userId, language, t) as unknown as { id: string }[]).map(
      (row) => row.id,
    );
    remove.run(userId, language, t);
    return expired;
  }

  return { add, list, expireOld };
}
