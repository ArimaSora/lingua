import type { Clock } from "./clock";
import type { Database } from "./database";
import type { EvidenceLevel, ExplanationLayer } from "./knowledge-entry";

// 讲解投递记录（issue #12）：交付的每条讲解可追溯到知识条目 ID + 证据等级 +
// 呈现层，挂在消息上（message_id）。条目本体是文件承载的策展内容（CC BY 4.0），
// 此处按交付时快照冗余存 evidence_level/layer，供抽检与「角色眼中的你」式审计。

export type ExplanationRef = {
  id: string;
  language: string;
  messageId: string;
  entryId: string;
  evidenceLevel: EvidenceLevel;
  layer: ExplanationLayer;
  createdAt: number;
};

export type ExplanationLog = {
  record(input: {
    language: string;
    messageId: string;
    entryId: string;
    evidenceLevel: EvidenceLevel;
    layer: ExplanationLayer;
  }): ExplanationRef;
  // 某条消息交付过的全部讲解引用，时间正序。
  forMessage(messageId: string): ExplanationRef[];
};

export type ExplanationLogOptions = {
  db: Database;
  clock: Clock;
};

type ExplanationRefRow = {
  id: string;
  language: string;
  message_id: string;
  entry_id: string;
  evidence_level: EvidenceLevel;
  layer: ExplanationLayer;
  created_at: number;
};

function rowToRef(row: ExplanationRefRow): ExplanationRef {
  return {
    id: row.id,
    language: row.language,
    messageId: row.message_id,
    entryId: row.entry_id,
    evidenceLevel: row.evidence_level,
    layer: row.layer,
    createdAt: row.created_at,
  };
}

export function openExplanationLog(options: ExplanationLogOptions): ExplanationLog {
  const { db, clock } = options;
  return {
    record(input) {
      const id = clock.newId();
      const createdAt = clock.now();
      db.prepare(
        `INSERT INTO explanation_refs
           (id, language, message_id, entry_id, evidence_level, layer, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.language,
        input.messageId,
        input.entryId,
        input.evidenceLevel,
        input.layer,
        createdAt,
      );
      return { id, createdAt, ...input };
    },
    forMessage(messageId) {
      const rows = db
        .prepare(
          `SELECT * FROM explanation_refs WHERE message_id = ?
           ORDER BY created_at, id`,
        )
        .all(messageId) as unknown as ExplanationRefRow[];
      return rows.map(rowToRef);
    },
  };
}
