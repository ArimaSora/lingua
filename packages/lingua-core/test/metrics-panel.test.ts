import { describe, expect, it } from "vitest";
import {
  AMBUSH_HIT_METRIC,
  APP_OPEN_METRIC,
  DEFAULT_PFA_PARAMS,
  pfaMastery,
  queryMetricsPanel,
  recordMetric,
  TOPIC_RESPONSE_METRIC,
} from "../src/index";
import { DAY, insertChunk, makeHarness, T0 } from "./helpers";

// 验证面板（issue #14）：四个首日指标全部由事件流计算，无平行数据源。
describe("queryMetricsPanel", () => {
  it("computes ambush hit rate = independent-production ambushes / total ambushes", () => {
    const { db, clock } = makeHarness();

    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 1 });
    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 0 });
    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 0 });

    const panel = queryMetricsPanel({ db, clock, language: "en" });
    expect(panel.ambushHitRate).toBeCloseTo(1 / 3, 6);
  });

  it("computes topic response rate = responded topics / started topics", () => {
    const { db, clock } = makeHarness();

    recordMetric({ db, clock, language: "en", name: TOPIC_RESPONSE_METRIC, value: 1 });
    recordMetric({ db, clock, language: "en", name: TOPIC_RESPONSE_METRIC, value: 1 });
    recordMetric({ db, clock, language: "en", name: TOPIC_RESPONSE_METRIC, value: 0 });

    const panel = queryMetricsPanel({ db, clock, language: "en" });
    expect(panel.topicResponseRate).toBeCloseTo(2 / 3, 6);
  });

  it("computes the PFA mastery curve as daily average mastery over enrolled chunks", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "c1");
    insertChunk(db, "c2");

    store.recordInitialLearning({ observationId: "pl-1", chunkId: "c1" });
    store.recordInitialLearning({ observationId: "pl-2", chunkId: "c2" });

    clock.set(T0 + 2 * DAY);
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "c1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
    });
    store.recordEvidence({
      observationId: "obs-2",
      chunkId: "c2",
      assistance: "none",
      outcome: "wrong",
      confidence: 0.95,
      quote: "I look up it",
    });

    const panel = queryMetricsPanel({ db, clock, language: "en", windowDays: 7 });
    expect(panel.masterySeries.length).toBe(7);

    const today = panel.masterySeries[panel.masterySeries.length - 1]!;
    const c1Mastery = pfaMastery(DEFAULT_PFA_PARAMS, 1, 0);
    const c2Mastery = pfaMastery(DEFAULT_PFA_PARAMS, 0, 1);
    expect(today.averageMastery).toBeCloseTo((c1Mastery + c2Mastery) / 2, 6);
  });

  it("computes D1/D7 retention from app-open metric events", () => {
    const { db, clock } = makeHarness();

    recordMetric({ db, clock, language: "en", name: APP_OPEN_METRIC, value: 1 });
    clock.set(T0 + DAY);
    recordMetric({ db, clock, language: "en", name: APP_OPEN_METRIC, value: 1 });
    clock.set(T0 + 2 * DAY);
    recordMetric({ db, clock, language: "en", name: APP_OPEN_METRIC, value: 1 });
    clock.set(T0 + 8 * DAY);
    recordMetric({ db, clock, language: "en", name: APP_OPEN_METRIC, value: 1 });

    // 查询发生在第 9 天，且当天尚未打开；只统计已完成的队列。
    clock.set(T0 + 9 * DAY);
    const panel = queryMetricsPanel({ db, clock, language: "en" });

    // 窗口内活跃日：T0, T0+1, T0+2, T0+8。
    // D1：次日也在窗口内且已完成的队列才可计入分母。
    //   T0 -> T0+1 活跃；T0+1 -> T0+2 活跃；T0+2 -> T0+3 不活跃；T0+8 -> T0+9 当天未完成，不计入。
    expect(panel.retention.d1).toBeCloseTo(2 / 3, 6);
    // D7：7 日后也在窗口内且已完成的队列才可计入分母。
    //   T0 -> T0+7 不活跃；T0+1 -> T0+8 活跃；T0+2 -> T0+9 当天未完成，不计入。
    expect(panel.retention.d7).toBeCloseTo(1 / 2, 6);
  });

  it("returns zero rates when no metric events exist", () => {
    const { db, clock } = makeHarness();

    const panel = queryMetricsPanel({ db, clock, language: "en" });
    expect(panel.ambushHitRate).toBe(0);
    expect(panel.topicResponseRate).toBe(0);
    expect(panel.retention.d1).toBe(0);
    expect(panel.retention.d7).toBe(0);
  });

  it("isolates metrics by language", () => {
    const { db, clock } = makeHarness();

    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 1 });
    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 0 });
    recordMetric({ db, clock, language: "ja", name: AMBUSH_HIT_METRIC, value: 1 });

    const enPanel = queryMetricsPanel({ db, clock, language: "en" });
    const jaPanel = queryMetricsPanel({ db, clock, language: "ja" });
    expect(enPanel.ambushHitRate).toBeCloseTo(0.5, 6);
    expect(jaPanel.ambushHitRate).toBe(1);
  });

  it("respects the windowDays parameter", () => {
    const { db, clock } = makeHarness();

    clock.set(T0 + 29 * DAY);
    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 0 });
    clock.set(T0 + 36 * DAY);
    recordMetric({ db, clock, language: "en", name: AMBUSH_HIT_METRIC, value: 1 });
    clock.set(T0 + 37 * DAY);

    const short = queryMetricsPanel({ db, clock, language: "en", windowDays: 7 });
    expect(short.ambushHitRate).toBe(1);

    const long = queryMetricsPanel({ db, clock, language: "en", windowDays: 42 });
    expect(long.ambushHitRate).toBeCloseTo(0.5, 6);
  });
});
