import type { Card, FSRSParameters } from "ts-fsrs";
import { createEmptyCard, FSRS, Rating, State } from "ts-fsrs";
import type { Database } from "./database";
import type { EventType, LinguaParams } from "./event-store";
import { rowToLearningEvent } from "./event-store";
import type { LearningEvent } from "./event-store";
import { DEFAULT_PFA_PARAMS, pfaMastery } from "./pfa";
import type { PfaParams } from "./pfa";

// ADR-0016：首次到期 = 预学次日。
export const INITIAL_REVIEW_DELAY_MS = 24 * 60 * 60 * 1000;

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

export type SkillMastery = {
  // v1 的技能点（KC）= 语块本身（见 pfa.ts）。
  skillId: string;
  successes: number;
  failures: number;
  mastery: number;
};

export type Projection = {
  mode: ProjectionMode;
  horizon: number;
  paramsVersion: string;
  chunks: ChunkMastery[];
  skills: SkillMastery[];
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
// language 给定时按语言隔离（spec 数据 schema：全部按语言隔离）。
function resolveAdmitted(
  db: Database,
  mode: ProjectionMode,
  horizon: number,
  threshold: number,
  language?: string,
): LearningEvent[] {
  const languageFilter = language ? " AND language = ?" : "";
  const horizonArgs = language ? [horizon, language] : [horizon];
  const versions =
    mode === "as-known"
      ? (db
          .prepare(
            `SELECT * FROM events WHERE event_type != 'void' AND recorded_at <= ?${languageFilter}`,
          )
          .all(...horizonArgs) as unknown as VersionRow[])
      : (db
          .prepare(
            `SELECT * FROM events WHERE event_type != 'void' AND occurred_at <= ?${languageFilter}`,
          )
          .all(...horizonArgs) as unknown as VersionRow[]);
  const voided = new Set(
    (
      (mode === "as-known"
        ? db
            .prepare(
              `SELECT voids_event_id FROM events WHERE event_type = 'void' AND recorded_at <= ?${languageFilter}`,
            )
            .all(...horizonArgs)
        : db
            .prepare(
              `SELECT voids_event_id FROM events WHERE event_type = 'void'${languageFilter}`,
            )
            .all(...(language ? [language] : []))) as unknown as { voids_event_id: string }[]
    ).map((row) => row.voids_event_id),
  );

  // 版本链按 (observation_id, chunk_id) 维护，避免一次用户消息含多个语块时互相覆盖。
  const byObservation = new Map<string, LearningEvent[]>();
  for (const row of versions) {
    const event = rowToLearningEvent(row);
    const key = `${event.observationId}:${event.chunkId ?? ""}`;
    const chain = byObservation.get(key) ?? [];
    chain.push(event);
    byObservation.set(key, chain);
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
    // initial-learning 不是判分证据：无置信度可门槛，矩阵准入直接放行（ADR-0016）。
    if (effective.eventType === "initial-learning") {
      admitted.push(effective);
      continue;
    }
    if (effective.confidence === null || effective.confidence < threshold) continue;
    // 矩阵准入：只放行携带状态更新载荷（FSRS 评分或 PFA 结果）的事件。
    if (effective.fsrsRating === null && effective.pfaOutcome === null) continue;
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

export function projectState(
  db: Database,
  mode: ProjectionMode,
  horizon: number,
  language?: string,
): Projection {
  const snapshot = snapshotFor(db, mode, horizon);
  const params = JSON.parse(snapshot.params) as LinguaParams;
  const pfaParams: PfaParams = params.pfa ?? DEFAULT_PFA_PARAMS;
  const admitted = resolveAdmitted(db, mode, horizon, params.confidenceThreshold, language);

  const fsrs = new FSRS(params.fsrs as FSRSParameters);
  const cards = new Map<string, Card>();
  const mastery = new Map<string, ChunkMastery>();
  const pfaCounts = new Map<string, { successes: number; failures: number }>();

  for (const event of admitted) {
    if (!event.chunkId) continue;

    // 初次学习单独记录（ADR-0016）：建立新卡片、首次到期 = 预学次日，
    // 不冒充成功回忆（无评分、不计 admittedEvidence）、不更新掌握度。
    if (event.eventType === "initial-learning") {
      if (cards.has(event.chunkId)) continue;
      const card = createEmptyCard(new Date(event.occurredAt));
      card.due = new Date(event.occurredAt + INITIAL_REVIEW_DELAY_MS);
      cards.set(event.chunkId, card);
      mastery.set(event.chunkId, {
        chunkId: event.chunkId,
        state: "new",
        stability: card.stability,
        difficulty: card.difficulty,
        reps: 0,
        lapses: 0,
        dueAt: card.due.getTime(),
        lastReviewAt: null,
        lastEventType: event.eventType,
        admittedEvidence: mastery.get(event.chunkId)?.admittedEvidence ?? 0,
      });
      continue;
    }

    if (event.fsrsRating) {
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

    if (event.pfaOutcome) {
      const counts = pfaCounts.get(event.chunkId) ?? { successes: 0, failures: 0 };
      if (event.pfaOutcome === "success") counts.successes += 1;
      else counts.failures += 1;
      pfaCounts.set(event.chunkId, counts);
    }
  }

  const skills: SkillMastery[] = [...pfaCounts.entries()]
    .map(([skillId, counts]) => ({
      skillId,
      successes: counts.successes,
      failures: counts.failures,
      mastery: pfaMastery(pfaParams, counts.successes, counts.failures),
    }))
    .sort((a, b) => (a.skillId < b.skillId ? -1 : 1));

  return {
    mode,
    horizon,
    paramsVersion: snapshot.id,
    chunks: [...mastery.values()].sort((a, b) => (a.chunkId < b.chunkId ? -1 : 1)),
    skills,
  };
}

// 有效学习历史（当前认知口径）：准入控制等模块复用同一条 ADR-0014 管线，
// 不另造历史口径。返回按 (occurred_at, event_id) 排序的准入事件。
export function admittedEvents(db: Database, horizon: number, language?: string): LearningEvent[] {
  const snapshot = snapshotFor(db, "current-belief", horizon);
  const params = JSON.parse(snapshot.params) as LinguaParams;
  return resolveAdmitted(db, "current-belief", horizon, params.confidenceThreshold, language);
}
