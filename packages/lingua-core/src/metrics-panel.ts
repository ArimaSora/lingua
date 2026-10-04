import type { Clock } from "./clock";
import type { Database } from "./database";
import { admittedEvents } from "./projection";
import { DEFAULT_PFA_PARAMS, pfaMastery } from "./pfa";
import type { PfaParams } from "./pfa";

// 验证面板（issue #14）：四个首日指标全部由事件流计算，无平行数据源。
// - 埋伏命中率 = 独立产出 / 埋伏次数（ADR-0013）。
// - 话题回应率 = 回应话题 / 发起话题。
// - 语块掌握曲线 = 近 N 天每日平均 PFA 掌握度。
// - 留存 = D1/D7 主动打开率（以 app-open 事件队列计算）。

const DEFAULT_WINDOW_DAYS = 28;
const MASTERY_SERIES_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MasteryPoint = {
  date: string; // YYYY-MM-DD
  averageMastery: number;
};

export type RetentionMetrics = {
  d1: number;
  d7: number;
};

export type MetricsPanel = {
  language: string;
  ambushHitRate: number;
  topicResponseRate: number;
  masterySeries: MasteryPoint[];
  retention: RetentionMetrics;
};

export type MetricsPanelInput = {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
  windowDays?: number;
};

function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function metricRate(
  db: Database,
  name: string,
  userId: string,
  language: string,
  since: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(value), 0) AS sum, COUNT(*) AS count
       FROM metric_events
       WHERE metric_name = ? AND user_id = ? AND language = ? AND created_at >= ?`,
    )
    .get(name, userId, language, since) as { sum: number; count: number };
  return row.count === 0 ? 0 : row.sum / row.count;
}

function activeDaySet(
  db: Database,
  name: string,
  userId: string,
  language: string,
  since: number,
): Set<number> {
  const rows = db
    .prepare(
      `SELECT created_at FROM metric_events
       WHERE metric_name = ? AND user_id = ? AND language = ? AND created_at >= ?`,
    )
    .all(name, userId, language, since) as unknown as { created_at: number }[];
  const days = new Set<number>();
  for (const row of rows) {
    days.add(dayStart(row.created_at));
  }
  return days;
}

function computeRetention(
  activeDays: Set<number>,
  todayStart: number,
  windowStart: number,
): RetentionMetrics {
  let d1Numerator = 0;
  let d1Denominator = 0;
  let d7Numerator = 0;
  let d7Denominator = 0;

  for (const day of activeDays) {
    if (day < windowStart || day >= todayStart) continue;

    if (day + DAY_MS < todayStart) {
      d1Denominator += 1;
      if (activeDays.has(day + DAY_MS)) d1Numerator += 1;
    }

    if (day + 7 * DAY_MS < todayStart) {
      d7Denominator += 1;
      if (activeDays.has(day + 7 * DAY_MS)) d7Numerator += 1;
    }
  }

  return {
    d1: d1Denominator === 0 ? 0 : d1Numerator / d1Denominator,
    d7: d7Denominator === 0 ? 0 : d7Numerator / d7Denominator,
  };
}

function averagePfaMastery(
  db: Database,
  params: PfaParams,
  horizon: number,
  language: string,
): number {
  const chunkRows = db
    .prepare("SELECT id FROM chunks WHERE language = ? AND status = 'enrolled'")
    .all(language) as unknown as { id: string }[];
  if (chunkRows.length === 0) return 0;

  const events = admittedEvents(db, horizon, language);
  const counts = new Map<string, { successes: number; failures: number }>();
  for (const event of events) {
    if (!event.chunkId || !event.pfaOutcome) continue;
    const current = counts.get(event.chunkId) ?? { successes: 0, failures: 0 };
    if (event.pfaOutcome === "success") current.successes += 1;
    else current.failures += 1;
    counts.set(event.chunkId, current);
  }

  let total = 0;
  for (const row of chunkRows) {
    const c = counts.get(row.id) ?? { successes: 0, failures: 0 };
    total += pfaMastery(params, c.successes, c.failures);
  }
  return total / chunkRows.length;
}

function buildMasterySeries(
  db: Database,
  params: PfaParams,
  todayStart: number,
  language: string,
): MasteryPoint[] {
  const series: MasteryPoint[] = [];
  for (let i = MASTERY_SERIES_DAYS - 1; i >= 0; i -= 1) {
    const dayEnd = todayStart - i * DAY_MS + DAY_MS - 1;
    series.push({
      date: isoDate(dayEnd),
      averageMastery: averagePfaMastery(db, params, dayEnd, language),
    });
  }
  return series;
}

export function queryMetricsPanel(input: MetricsPanelInput): MetricsPanel {
  const { db, clock, language } = input;
  const userId = input.userId ?? "local";
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = clock.now();
  const todayStart = dayStart(now);
  const windowStart = todayStart - windowDays * DAY_MS;

  const params = DEFAULT_PFA_PARAMS;

  return {
    language,
    ambushHitRate: metricRate(db, "ambush-hit", userId, language, windowStart),
    topicResponseRate: metricRate(db, "topic-response", userId, language, windowStart),
    masterySeries: buildMasterySeries(db, params, todayStart, language),
    retention: computeRetention(
      activeDaySet(db, "app-open", userId, language, windowStart),
      todayStart,
      windowStart,
    ),
  };
}
