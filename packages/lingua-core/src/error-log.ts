import type { Clock } from "./clock";
import type { Database } from "./database";

// 错误日志（issue #8）：传感器记录的语法/用法错误流水，仅供系统小结与
// 「角色眼中的你」抽检页消费；与学习者状态、关系记忆、prompt 注入之间
// 无直接写入路径。

export type ErrorLogEntry = {
  id: string;
  userId: string;
  language: string;
  originalText: string;
  quote: string | null;
  errorType: string | null;
  topicId: string | null;
  chunkId: string | null;
  eventId: string | null;
  phenomenon: string | null;
  correction: string | null;
  createdAt: number;
};

export type RecordErrorLogInput = {
  db: Database;
  clock: Clock;
  userId?: string;
  language: string;
  originalText: string;
  quote?: string;
  errorType?: string;
  topicId?: string;
  chunkId?: string;
  eventId?: string;
  phenomenon: string;
  correction: string;
};

type ErrorLogRow = {
  id: string;
  user_id: string;
  language: string;
  original_text: string;
  quote: string | null;
  error_type: string | null;
  topic_id: string | null;
  chunk_id: string | null;
  event_id: string | null;
  phenomenon: string | null;
  correction: string | null;
  created_at: number;
};

function rowToEntry(row: ErrorLogRow): ErrorLogEntry {
  return {
    id: row.id,
    userId: row.user_id,
    language: row.language,
    originalText: row.original_text,
    quote: row.quote,
    errorType: row.error_type,
    topicId: row.topic_id,
    chunkId: row.chunk_id,
    eventId: row.event_id,
    phenomenon: row.phenomenon,
    correction: row.correction,
    createdAt: row.created_at,
  };
}

export function recordErrorLog(input: RecordErrorLogInput): ErrorLogEntry {
  const { db, clock } = input;
  const userId = input.userId ?? "local";
  const id = clock.newId();
  const createdAt = clock.now();

  db.prepare(
    `INSERT INTO error_logs (
       id, user_id, language, original_text, quote, error_type,
       topic_id, chunk_id, event_id, phenomenon, correction, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    input.language,
    input.originalText,
    input.quote ?? null,
    input.errorType ?? null,
    input.topicId ?? null,
    input.chunkId ?? null,
    input.eventId ?? null,
    input.phenomenon,
    input.correction,
    createdAt,
  );

  return {
    id,
    userId,
    language: input.language,
    originalText: input.originalText,
    quote: input.quote ?? null,
    errorType: input.errorType ?? null,
    topicId: input.topicId ?? null,
    chunkId: input.chunkId ?? null,
    eventId: input.eventId ?? null,
    phenomenon: input.phenomenon,
    correction: input.correction,
    createdAt,
  };
}

export function countTopicErrors(db: Database, topicId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM error_logs WHERE topic_id = ?")
    .get(topicId) as { n: number } | undefined;
  return row ? Number(row.n) : 0;
}

export function listTopicErrors(db: Database, topicId: string): ErrorLogEntry[] {
  const rows = db
    .prepare(
      "SELECT * FROM error_logs WHERE topic_id = ? ORDER BY created_at, id",
    )
    .all(topicId) as unknown as ErrorLogRow[];
  return rows.map(rowToEntry);
}
