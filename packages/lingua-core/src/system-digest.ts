import type { Clock } from "./clock";
import type { Database } from "./database";
import { DAY_MS, dayStart } from "./day";
import { listTopicErrors } from "./error-log";
import { projectState } from "./projection";

// 系统小结（issue #8）：事件驱动，只在系统会话发送；
// 触发条件 = 话题结束（30 分钟无活动或已 resolved/stale）或错误累计 ≥3 条。
// 内容：该话题判分回顾 + 一个 prompt 式留白纠错点（details/summary 折叠）
// + 明日到期预告。

// 话题空闲边界：30 分钟无活动即视为话题结束（启发式）。
export const TOPIC_IDLE_MS = 30 * 60 * 1000;
// 错误阈值：累计 ≥3 条错误时立即触发小结。
export const ERROR_DIGEST_THRESHOLD = 3;

// 留白式纠错的可展开标记，UI 据此渲染为 details/summary（参考票 06 预学清单）。
export const CORRECTION_OPEN = "[[纠错]]";
export const CORRECTION_CLOSE = "[[/纠错]]";

export type SystemDigest = {
  topicId: string;
  text: string;
  errorCount: number;
};

export type RenderSystemDigestsOptions = {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
};

type TopicRow = {
  id: string;
  user_id: string;
  language: string;
  status: string;
  topic_text: string;
  opened_at: number;
  closed_at: number | null;
  digest_sent_at: number | null;
};

type PlacementRow = {
  id: string;
  topic_id: string;
  chunk_id: string;
  outcome: "hit" | "missed" | null;
};

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function tomorrowStart(now: number): number {
  return dayStart(now) + DAY_MS;
}

function isTopicEnded(row: TopicRow, now: number): boolean {
  if (row.status === "resolved" || row.status === "stale") return true;
  // 30 分钟空闲边界：open 话题超过空闲阈值未回应即视为结束。
  return row.status === "open" && row.opened_at + TOPIC_IDLE_MS < now;
}

function renderCorrection(error: {
  quote: string | null;
  phenomenon: string | null;
  correction: string | null;
}): string {
  const phenomenon = error.phenomenon ?? "你刚才的表达里有个地方可以注意一下。";
  const correction = error.correction ?? "（暂无参考答案）";
  return [
    CORRECTION_OPEN,
    phenomenon,
    correction,
    CORRECTION_CLOSE,
  ].join("\n");
}

function renderScoringReview(placements: PlacementRow[]): string {
  const total = placements.length;
  const hits = placements.filter((p) => p.outcome === "hit").length;
  const misses = placements.filter((p) => p.outcome === "missed").length;
  return `判分回顾：本话题埋入 ${total} 个语块，命中 ${hits} 个，未命中 ${misses} 个。`;
}

function renderDueForecast(db: Database, now: number, language: string): string {
  const projection = projectState(db, "current-belief", now, language);
  const tomorrow = tomorrowStart(now);
  const nextDay = tomorrow + DAY_MS;
  const dueTomorrow = projection.chunks.filter(
    (chunk) => chunk.dueAt !== null && chunk.dueAt >= tomorrow && chunk.dueAt < nextDay,
  ).length;
  return `明日到期预告：明天有 ${dueTomorrow} 个语块到期复习。`;
}

function renderTopicDigest(options: {
  db: Database;
  clock: Clock;
  topic: TopicRow;
  placements: PlacementRow[];
  errors: ReturnType<typeof listTopicErrors>;
}): SystemDigest {
  const { db, clock, topic, placements, errors } = options;
  const now = clock.now();

  const lines: string[] = [];
  lines.push(`【系统小结】${topic.topic_text}`);
  lines.push("");

  if (isTopicEnded(topic, now)) {
    lines.push("话题已结束。");
  } else {
    lines.push(`错误累计已达 ${errors.length} 条，提前发送小结。`);
  }
  lines.push("");

  lines.push(renderScoringReview(placements));
  lines.push("");

  // 只取最近一条错误做留白式纠错。
  const targetError = errors[errors.length - 1];
  if (targetError) {
    lines.push(renderCorrection(targetError));
    lines.push("");
  }

  lines.push(renderDueForecast(db, now, topic.language));

  return {
    topicId: topic.id,
    text: lines.join("\n"),
    errorCount: errors.length,
  };
}

export function renderPendingSystemDigests(options: RenderSystemDigestsOptions): SystemDigest[] {
  const { db, clock, language } = options;
  const userId = options.userId ?? "local";
  const now = clock.now();

  const rows = db
    .prepare(
      `SELECT * FROM ambush_topics
       WHERE user_id = ? AND language = ? AND digest_sent_at IS NULL`,
    )
    .all(userId, language) as unknown as TopicRow[];

  const digests: SystemDigest[] = [];
  for (const topic of rows) {
    const errors = listTopicErrors(db, topic.id);
    const shouldSend =
      errors.length >= ERROR_DIGEST_THRESHOLD || isTopicEnded(topic, now);
    if (!shouldSend) continue;

    const placements = db
      .prepare(
        "SELECT id, topic_id, chunk_id, outcome FROM ambush_placements WHERE topic_id = ? AND user_id = ?",
      )
      .all(topic.id, userId) as unknown as PlacementRow[];

    digests.push(renderTopicDigest({ db, clock, topic, placements, errors }));
  }

  return digests;
}

export function markTopicDigestSent(db: Database, topicId: string, sentAt: number): void {
  db.prepare("UPDATE ambush_topics SET digest_sent_at = ? WHERE id = ?").run(sentAt, topicId);
}
