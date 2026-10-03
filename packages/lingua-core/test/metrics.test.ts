import { describe, expect, it } from "vitest";
import { AMBUSH_HIT_METRIC, recordMetric, TOPIC_RESPONSE_METRIC } from "../src/index";
import { makeHarness, T0 } from "./helpers";

// 指标事件（issue #7）：埋伏命中率与话题回应率的原子事件落 metric_events（schema v1 已有），
// 供票 14 聚合消费——命中率 = 独立产出/埋伏次数（ADR-0013），回应率 = 回应话题/发起话题。
describe("recordMetric", () => {
  it("persists a metric event with name, value and payload", () => {
    const { db, clock } = makeHarness();

    recordMetric({
      db,
      clock,
      language: "en",
      name: AMBUSH_HIT_METRIC,
      value: 1,
      payload: { topicId: "topic-1", chunkId: "chunk-1", eventType: "independent-production" },
    });

    const rows = db
      .prepare("SELECT * FROM metric_events")
      .all() as unknown as {
      id: string;
      user_id: string;
      language: string;
      metric_name: string;
      value: number;
      payload: string;
      created_at: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metric_name).toBe("ambush-hit");
    expect(rows[0]!.value).toBe(1);
    expect(rows[0]!.language).toBe("en");
    expect(rows[0]!.created_at).toBe(T0);
    expect(JSON.parse(rows[0]!.payload)).toEqual({
      topicId: "topic-1",
      chunkId: "chunk-1",
      eventType: "independent-production",
    });
  });

  it("keeps atomic events separate so rates can be aggregated later", () => {
    const { db, clock } = makeHarness();

    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 1 });
    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 0 });
    recordMetric({ db, clock, language: "en", name: TOPIC_RESPONSE_METRIC, value: 1 });

    const rows = db
      .prepare("SELECT metric_name, value FROM metric_events ORDER BY created_at, id")
      .all() as unknown as { metric_name: string; value: number }[];
    expect(rows).toEqual([
      { metric_name: "ambush-hit", value: 1 },
      { metric_name: "ambush-hit", value: 0 },
      { metric_name: "topic-response", value: 1 },
    ]);
  });

  it("defaults payload to an empty object and isolates by language", () => {
    const { db, clock } = makeHarness();

    recordMetric({ db, clock, language: "ja", name: TOPIC_RESPONSE_METRIC, value: 0 });

    const row = db.prepare("SELECT * FROM metric_events").get() as unknown as {
      language: string;
      payload: string;
    };
    expect(row.language).toBe("ja");
    expect(JSON.parse(row.payload)).toEqual({});
  });
});
