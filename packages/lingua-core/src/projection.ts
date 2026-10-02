import type { Card, FSRSParameters } from "ts-fsrs";
import { createEmptyCard, FSRS, Rating, State } from "ts-fsrs";
import type { Database } from "./database";
import type { EventType, LinguaParams } from "./event-store";
import { rowToLearningEvent } from "./event-store";
import type { LearningEvent } from "./event-store";

export type ProjectionMode = "as-known" | "current-belief";

export type ChunkMastery = {
  chunkId: string;
  state: "new" | "learning" | "review" | "relearning";
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  dueAt: number | null;
  lastReviewAt: number | null;
  lastEventType: EventType;
  admittedEvidence: number;
};

export type Projection = {
  mode: ProjectionMode;
  horizon: number;
  paramsVersion: string;
  chunks: ChunkMastery[];
};

type SnapshotRow = { id: string; params: string };

function snapshotFor(db: Database, mode: ProjectionMode, horizon: number): SnapshotRow {
  // 当时所知按当时参数版本投影；当前认知按当前参数版本投影（ADR-0014 规则 6）。
  const row = (
    mode === "as-known"
      ? db.prepare(
          `SELECT id, params FROM param_snapshots WHERE created_at <= ?
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        ).get(horizon) ??
        db.prepare(
          "SELECT id, params FROM param_snapshots ORDER BY created_at ASC, id ASC LIMIT 1",
        ).get()
      : db.prepare(
          "SELECT id, params FROM param_snapshots ORDER BY created_at DESC, id DESC LIMIT 1",
        ).get()
  ) as SnapshotRow | undefined;
  if (!row) throw new Error("no parameter snapshot available");
  return row;
}

type VersionRow = Parameters<typeof rowToLearningEvent>[0];

// ADR-0014 规则 5 统一管线：时间截点 → 有效版本 → 置信度与矩阵准入 → 投影。
// 有效版本 = 截至知识地平线最新且未被撤销的版本；低置信度不回溯旧版本。
function resolveAdmitted(
  db: Database,
  mode: ProjectionMode,
  horizon: number,
  threshold: number,
): LearningEvent[] {
  const versions =
    mode === "as-known"
      ? (db
          .prepare("SELECT * FROM events WHERE event_type != 'void' AND recorded_at <= ?")
          .all(horizon) as unknown as VersionRow[])
      : (db
          .prepare("SELECT * FROM events WHERE event_type != 'void' AND occurred_at <= ?")
          .all(horizon) as unknown as VersionRow[]);
  const voided = new Set(
    (
      (mode === "as-known"
        ? db
            .prepare(
              "SELECT voids_event_id FROM events WHERE event_type = 'void' AND recorded_at <= ?",
            )
            .all(horizon)
        : db
            .prepare("SELECT voids_event_id FROM events WHERE event_type = 'void'")
            .all()) as unknown as { voids_event_id: string }[]
    ).map((row) => row.voids_event_id),
  );

  const byObservation = new Map<string, LearningEvent[]>();
  for (const row of versions) {
    const event = rowToLearningEvent(row);
    const chain = byObservation.get(event.observationId) ?? [];
    chain.push(event);
    byObservation.set(event.observationId, chain);
  }

  const admitted: LearningEvent[] = [];
  for (const chain of byObservation.values()) {
    chain.sort((a, b) =>
      a.recordedAt !== b.recordedAt
        ? b.recordedAt - a.recordedAt
        : b.eventId < a.eventId
          ? -1
          : 1,
    );
    const effective = chain.find((event) => !voided.has(event.eventId));
    if (!effective) continue;
    if (effective.confidence === null || effective.confidence < threshold) continue;
    if (effective.fsrsRating === null) continue;
    admitted.push(effective);
  }

  // 事件排序按 (occurred_at, event_id)（ADR-0014 规则 4）。
  admitted.sort((a, b) =>
    a.occurredAt !== b.occurredAt
      ? a.occurredAt - b.occurredAt
      : a.eventId < b.eventId
        ? -1
        : 1,
  );
  return admitted;
}

const STATE_NAMES = ["new", "learning", "review", "relearning"] as const;

export function projectState(db: Database, mode: ProjectionMode, horizon: number): Projection {
  const snapshot = snapshotFor(db, mode, horizon);
  const params = JSON.parse(snapshot.params) as LinguaParams;
  const admitted = resolveAdmitted(db, mode, horizon, params.confidenceThreshold);

  const fsrs = new FSRS(params.fsrs as FSRSParameters);
  const cards = new Map<string, Card>();
  const mastery = new Map<string, ChunkMastery>();

  for (const event of admitted) {
    if (!event.chunkId || !event.fsrsRating) continue;
    const card: Card = cards.get(event.chunkId) ?? createEmptyCard(new Date(event.occurredAt));
    const scheduled = fsrs.repeat(card, new Date(event.occurredAt));
    const item = scheduled[event.fsrsRating === "good" ? Rating.Good : Rating.Again];
    if (!item) throw new Error(`no scheduling record for rating ${event.fsrsRating}`);
    const next = item.card;
    cards.set(event.chunkId, next);

    const previous = mastery.get(event.chunkId);
    mastery.set(event.chunkId, {
      chunkId: event.chunkId,
      state: STATE_NAMES[next.state as number] ?? "new",
      stability: next.stability,
      difficulty: next.difficulty,
      reps: next.reps,
      lapses: next.lapses,
      dueAt: next.due.getTime(),
      lastReviewAt: next.last_review ? next.last_review.getTime() : null,
      lastEventType: event.eventType,
      admittedEvidence: (previous?.admittedEvidence ?? 0) + 1,
    });
  }

  return {
    mode,
    horizon,
    paramsVersion: snapshot.id,
    chunks: [...mastery.values()].sort((a, b) => (a.chunkId < b.chunkId ? -1 : 1)),
  };
}
