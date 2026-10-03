import type { FSRSParameters } from "ts-fsrs";
import { generatorParameters } from "ts-fsrs";
import type { Clock } from "./clock";
import type { Database } from "./database";
import { DEFAULT_PFA_PARAMS } from "./pfa";
import type { PfaParams } from "./pfa";
import { projectState } from "./projection";
import type { Projection } from "./projection";

export type Assistance = "none" | "assisted";
export type Outcome = "correct" | "wrong" | "not-produced";

// ADR-0013 事件类型：独立产出 / 独立尝试失败 / 辅助产出 / 辅助尝试失败 / 未获得证据。
// ADR-0016 增补：预学完成单独记录 initial-learning，不冒充成功回忆。
export type EventType =
  | "independent-production"
  | "independent-attempt-failed"
  | "assisted-production"
  | "assisted-attempt-failed"
  | "no-evidence"
  | "initial-learning"
  | "void";

export type FsrsRating = "again" | "good";
export type PfaOutcome = "success" | "failure";

// 窄写入接口（ADR-0014）：写入者只提供证据，事件类型、applied、矩阵映射
// 全部由追加路径派生。
export type Evidence = {
  observationId: string;
  chunkId: string;
  confidence: number;
  quote: string;
  occurredAt?: number;
  topicId?: string;
  judge?: { name: string; version: string };
} & (
  | { outcome: "correct" | "wrong"; assistance: Assistance }
  | { outcome: "not-produced"; assistance?: Assistance }
);

export type LearningEvent = {
  eventId: string;
  observationId: string;
  chunkId: string | null;
  userId: string;
  language: string;
  occurredAt: number;
  recordedAt: number;
  topicId: string | null;
  quote: string | null;
  assistance: Assistance | null;
  outcome: Outcome | null;
  eventType: EventType;
  confidence: number | null;
  judgeName: string | null;
  judgeVersion: string | null;
  paramsVersion: string | null;
  fsrsRating: FsrsRating | null;
  pfaOutcome: PfaOutcome | null;
  applied: boolean;
  supersedesEventId: string | null;
  voidsEventId: string | null;
  voidReason: string | null;
};

export type LinguaParams = {
  confidenceThreshold: number;
  fsrs: FSRSParameters;
  pfa: PfaParams;
};

export function defaultParams(): LinguaParams {
  return {
    confidenceThreshold: 0.7,
    // 回放必须确定性：禁用 fuzz。
    fsrs: generatorParameters({ enable_fuzz: false }),
    pfa: DEFAULT_PFA_PARAMS,
  };
}

const DEFAULT_SNAPSHOT_ID = "params-v1";

export type EventStore = {
  recordEvidence(evidence: Evidence): LearningEvent;
  // 预学完成（ADR-0016）：初次学习单独记录，不更新掌握度；
  // 首次到期 = 预学次日，首次 FSRS 评分来自首次真实回忆。
  recordInitialLearning(input: {
    observationId: string;
    chunkId: string;
    occurredAt?: number;
  }): LearningEvent;
  // 纠错 = 追加撤销事件（ADR-0014 规则 3），不修改原记录；
  // 撤销以 recorded_at 进入时间线。
  voidObservation(input: { observationId: string; reason?: string }): LearningEvent;
  // as-of 双模式投影查询（ADR-0014 规则 6）：知识地平线必须显式给定。
  // 当时所知：只考虑 recorded_at ≤ 地平线的事件与撤销，按当时参数版本投影。
  // 当前认知：occurred_at ≤ 地平线、排除任何时间被撤销者，按当前参数版本投影。
  asKnownAt(horizon: number): Projection;
  currentBeliefAt(horizon: number): Projection;
};

export type EventStoreOptions = {
  db: Database;
  clock: Clock;
  userId?: string;
};

type EventRow = {
  event_id: string;
  observation_id: string;
  chunk_id: string | null;
  user_id: string;
  language: string;
  occurred_at: number;
  recorded_at: number;
  topic_id: string | null;
  quote: string | null;
  assistance: Assistance | null;
  outcome: Outcome | null;
  event_type: EventType;
  confidence: number | null;
  judge_name: string | null;
  judge_version: string | null;
  params_version: string | null;
  fsrs_rating: FsrsRating | null;
  pfa_outcome: PfaOutcome | null;
  applied: number;
  supersedes_event_id: string | null;
  voids_event_id: string | null;
  void_reason: string | null;
};

export function rowToLearningEvent(row: EventRow): LearningEvent {
  return {
    eventId: row.event_id,
    observationId: row.observation_id,
    chunkId: row.chunk_id,
    userId: row.user_id,
    language: row.language,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    topicId: row.topic_id,
    quote: row.quote,
    assistance: row.assistance,
    outcome: row.outcome,
    eventType: row.event_type,
    confidence: row.confidence,
    judgeName: row.judge_name,
    judgeVersion: row.judge_version,
    paramsVersion: row.params_version,
    fsrsRating: row.fsrs_rating,
    pfaOutcome: row.pfa_outcome,
    applied: row.applied === 1,
    supersedesEventId: row.supersedes_event_id,
    voidsEventId: row.voids_event_id,
    voidReason: row.void_reason,
  };
}

// ADR-0013 事件更新矩阵：判分器供证据（辅助情况 × 产出结果），领域逻辑执行映射。
function deriveFromEvidence(evidence: Evidence): {
  eventType: EventType;
  fsrsRating: FsrsRating | null;
  pfaOutcome: PfaOutcome | null;
} {
  if (evidence.outcome === "not-produced") {
    return { eventType: "no-evidence", fsrsRating: null, pfaOutcome: null };
  }
  if (evidence.assistance === "none") {
    return evidence.outcome === "correct"
      ? { eventType: "independent-production", fsrsRating: "good", pfaOutcome: "success" }
      : { eventType: "independent-attempt-failed", fsrsRating: "again", pfaOutcome: "failure" };
  }
  return evidence.outcome === "correct"
    ? { eventType: "assisted-production", fsrsRating: null, pfaOutcome: null }
    : { eventType: "assisted-attempt-failed", fsrsRating: null, pfaOutcome: "failure" };
}

function ensureDefaultSnapshot(db: Database, clock: Clock, userId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO param_snapshots (id, user_id, language, params, created_at)
     VALUES (?, ?, '*', ?, ?)`,
  ).run(DEFAULT_SNAPSHOT_ID, userId, JSON.stringify(defaultParams()), clock.now());
}

function latestSnapshot(db: Database): { id: string; params: LinguaParams } {
  const row = db
    .prepare("SELECT id, params FROM param_snapshots ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as { id: string; params: string } | undefined;
  if (!row) throw new Error("no parameter snapshot available");
  return { id: row.id, params: JSON.parse(row.params) as LinguaParams };
}

export function openEventStore(options: EventStoreOptions): EventStore {
  const { db, clock } = options;
  const userId = options.userId ?? "local";
  ensureDefaultSnapshot(db, clock, userId);

  const getChunk = db.prepare("SELECT language FROM chunks WHERE id = ?");
  const latestVersion = db.prepare(
    `SELECT event_id FROM events
     WHERE observation_id = ? AND event_type != 'void'
     ORDER BY recorded_at DESC, event_id DESC LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO events (
       event_id, user_id, language, observation_id, chunk_id,
       occurred_at, recorded_at, topic_id, quote,
       assistance, outcome, event_type, confidence,
       judge_name, judge_version, params_version,
       fsrs_rating, pfa_outcome, applied,
       supersedes_event_id, voids_event_id, void_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function insertEventRow(row: EventRow): void {
    insert.run(
      row.event_id,
      row.user_id,
      row.language,
      row.observation_id,
      row.chunk_id,
      row.occurred_at,
      row.recorded_at,
      row.topic_id,
      row.quote,
      row.assistance,
      row.outcome,
      row.event_type,
      row.confidence,
      row.judge_name,
      row.judge_version,
      row.params_version,
      row.fsrs_rating,
      row.pfa_outcome,
      row.applied,
      row.supersedes_event_id,
      row.voids_event_id,
      row.void_reason,
    );
  }

  function recordEvidence(evidence: Evidence): LearningEvent {
    if (evidence.confidence < 0 || evidence.confidence > 1) {
      throw new Error(`confidence out of range: ${evidence.confidence}`);
    }
    const chunk = getChunk.get(evidence.chunkId) as { language: string } | undefined;
    if (!chunk) {
      throw new Error(`unknown chunk: ${evidence.chunkId}`);
    }

    const derived = deriveFromEvidence(evidence);
    // applied 必须由事件引用的那份参数快照推导（ADR-0014 审计一致性）。
    // 状态消费者 = FSRS 记忆状态 + PFA 掌握度：携带任一更新载荷
    // （fsrs_rating 或 pfa_outcome）且置信度达标即 applied。
    const snapshot = latestSnapshot(db);
    const applied =
      evidence.confidence >= snapshot.params.confidenceThreshold &&
      (derived.fsrsRating !== null || derived.pfaOutcome !== null);
    const tip = latestVersion.get(evidence.observationId) as
      | { event_id: string }
      | undefined;

    const recordedAt = clock.now();
    const row: EventRow = {
      event_id: clock.newId(),
      user_id: userId,
      language: chunk.language,
      observation_id: evidence.observationId,
      chunk_id: evidence.chunkId,
      occurred_at: evidence.occurredAt ?? recordedAt,
      recorded_at: recordedAt,
      topic_id: evidence.topicId ?? null,
      quote: evidence.quote,
      assistance:
        evidence.outcome === "not-produced" ? null : evidence.assistance,
      outcome: evidence.outcome,
      event_type: derived.eventType,
      confidence: evidence.confidence,
      judge_name: evidence.judge?.name ?? null,
      judge_version: evidence.judge?.version ?? null,
      params_version: snapshot.id,
      fsrs_rating: derived.fsrsRating,
      pfa_outcome: derived.pfaOutcome,
      applied: applied ? 1 : 0,
      supersedes_event_id: tip?.event_id ?? null,
      voids_event_id: null,
      void_reason: null,
    };

    insertEventRow(row);

    return rowToLearningEvent(row);
  }

  function recordInitialLearning(input: {
    observationId: string;
    chunkId: string;
    occurredAt?: number;
  }): LearningEvent {
    const chunk = getChunk.get(input.chunkId) as { language: string } | undefined;
    if (!chunk) {
      throw new Error(`unknown chunk: ${input.chunkId}`);
    }

    const snapshot = latestSnapshot(db);
    const tip = latestVersion.get(input.observationId) as
      | { event_id: string }
      | undefined;

    const recordedAt = clock.now();
    const row: EventRow = {
      event_id: clock.newId(),
      user_id: userId,
      language: chunk.language,
      observation_id: input.observationId,
      chunk_id: input.chunkId,
      occurred_at: input.occurredAt ?? recordedAt,
      recorded_at: recordedAt,
      topic_id: null,
      quote: null,
      assistance: null,
      outcome: null,
      event_type: "initial-learning",
      confidence: null,
      judge_name: null,
      judge_version: null,
      params_version: snapshot.id,
      fsrs_rating: null,
      pfa_outcome: null,
      applied: 1,
      supersedes_event_id: tip?.event_id ?? null,
      voids_event_id: null,
      void_reason: null,
    };

    insertEventRow(row);

    return rowToLearningEvent(row);
  }

  function voidObservation(input: { observationId: string; reason?: string }): LearningEvent {
    // 有效版本 = 全时间线上最新且未被撤销的版本；撤销只指向它，
    // 之后追加的新版本不受影响。
    const chain = db
      .prepare(
        `SELECT * FROM events
         WHERE observation_id = ? AND event_type != 'void'
         ORDER BY recorded_at DESC, event_id DESC`,
      )
      .all(input.observationId) as unknown as EventRow[];
    const voided = new Set(
      (
        db
          .prepare(
            "SELECT voids_event_id FROM events WHERE observation_id = ? AND event_type = 'void'",
          )
          .all(input.observationId) as unknown as { voids_event_id: string }[]
      ).map((row) => row.voids_event_id),
    );
    const tip = chain.find((row) => !voided.has(row.event_id));
    if (!tip) {
      throw new Error(`no effective version for observation: ${input.observationId}`);
    }

    const recordedAt = clock.now();
    const row: EventRow = {
      event_id: clock.newId(),
      user_id: userId,
      language: tip.language,
      observation_id: input.observationId,
      chunk_id: tip.chunk_id,
      occurred_at: tip.occurred_at,
      recorded_at: recordedAt,
      topic_id: null,
      quote: null,
      assistance: null,
      outcome: null,
      event_type: "void",
      confidence: null,
      judge_name: null,
      judge_version: null,
      params_version: null,
      fsrs_rating: null,
      pfa_outcome: null,
      applied: 0,
      supersedes_event_id: null,
      voids_event_id: tip.event_id,
      void_reason: input.reason ?? null,
    };

    insertEventRow(row);

    return rowToLearningEvent(row);
  }

  return {
    recordEvidence,
    recordInitialLearning,
    voidObservation,
    asKnownAt: (horizon: number) => projectState(db, "as-known", horizon),
    currentBeliefAt: (horizon: number) => projectState(db, "current-belief", horizon),
  };
}
