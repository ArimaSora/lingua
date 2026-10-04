import type { Clock } from "./clock";
import type { Database } from "./database";

// 指标事件（issue #7）：mvp.md 度量埋点（埋伏命中率、话题回应率……）的原子事件
// 写入 metric_events（schema v1）。本模块只写不读——比率聚合（命中率 =
// 独立产出/埋伏次数，ADR-0013）归票 14，对原子事件求均值即可。

// 每次埋伏结算一条：value = 1 命中（独立产出）/ 0 未命中（其余一切结果）。
export const AMBUSH_HIT_METRIC = "ambush-hit";
// 每次话题关闭一条：value = 1 用户回应了话题 / 0 话题超期未回应。
export const TOPIC_RESPONSE_METRIC = "topic-response";
// 每次壳层启动一条：value = 1，created_at 用于计算主动打开留存。
export const APP_OPEN_METRIC = "app-open";
// 每次转述任务投递给角色一条：value = 1（issue #19，易腐难文的角色转述出路）。
export const RETELLING_METRIC = "retelling-delivered";

export type MetricName =
  | typeof AMBUSH_HIT_METRIC
  | typeof TOPIC_RESPONSE_METRIC
  | typeof APP_OPEN_METRIC
  | typeof RETELLING_METRIC;

export type MetricInput = {
  db: Database;
  clock: Clock;
  language: string;
  name: MetricName;
  value: number;
  payload?: Record<string, unknown>;
  userId?: string;
};

export function recordMetric(input: MetricInput): void {
  input.db
    .prepare(
      `INSERT INTO metric_events (id, user_id, language, metric_name, value, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.clock.newId(),
      input.userId ?? "local",
      input.language,
      input.name,
      input.value,
      JSON.stringify(input.payload ?? {}),
      input.clock.now(),
    );
}
