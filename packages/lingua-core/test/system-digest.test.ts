import { describe, expect, it } from "vitest";
import { openAmbush } from "../src/ambush";
import { createJudge } from "../src/judge";
import {
  CORRECTION_CLOSE,
  CORRECTION_OPEN,
  ERROR_DIGEST_THRESHOLD,
  markTopicDigestSent,
  renderPendingSystemDigests,
  TOPIC_IDLE_MS,
} from "../src/system-digest";
import {
  DAY,
  HOUR,
  insertAmbushPlacement,
  insertAmbushTopic,
  insertChunk,
  makeHarness,
  MINUTE,
  T0,
} from "./helpers";

function fakeUsageJudge(outcome: "correct" | "wrong") {
  return {
    name: "fake-usage",
    version: "0.1",
    async judgeUsage() {
      return { outcome, confidence: 0.85 };
    },
  };
}

// 系统小结（issue #8）：事件驱动，话题结束或错误累计 ≥3 条触发；
// 只发在系统会话，包含判分回顾 + 一个留白式纠错 + 明日到期预告。

describe("renderPendingSystemDigests", () => {
  it("renders a digest when a resolved topic has errors", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    insertChunk(db, "c1", { form: "look for" });
    insertChunk(db, "c2", { form: "see you around" });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "c1" });
    store.recordInitialLearning({ observationId: "pl-2", chunkId: "c2" });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;

    const judge = createJudge({ db, usageJudge: fakeUsageJudge("wrong") });
    await ambush.resolveTopic({
      topicId: plan.topicId,
      userText: "I look for my keys yesterday and see you around later.",
      judge,
      store,
    });

    const digests = renderPendingSystemDigests({ db, clock, language: "en" });

    expect(digests).toHaveLength(1);
    expect(digests[0]!.topicId).toBe(plan.topicId);
    expect(digests[0]!.text).toContain("判分回顾");
    expect(digests[0]!.text).toContain(CORRECTION_OPEN);
    expect(digests[0]!.text).toContain(CORRECTION_CLOSE);
    expect(digests[0]!.text).toContain("明日到期");
    expect(digests[0]!.errorCount).toBeGreaterThan(0);
  });

  it("renders a digest when an open topic has been idle for 30 minutes", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    insertChunk(db, "c1", { form: "look for" });
    insertChunk(db, "c2", { form: "see you around" });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "c1" });
    store.recordInitialLearning({ observationId: "pl-2", chunkId: "c2" });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;

    // 用户未回应，话题空闲超过 30 分钟。
    clock.set(clock.now() + TOPIC_IDLE_MS + MINUTE);

    const digests = renderPendingSystemDigests({ db, clock, language: "en" });

    expect(digests).toHaveLength(1);
    expect(digests[0]!.topicId).toBe(plan.topicId);
    expect(digests[0]!.text).toContain("话题已结束");
  });

  it("renders a digest immediately when error count reaches threshold", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    for (let i = 0; i < ERROR_DIGEST_THRESHOLD; i += 1) {
      insertChunk(db, `c${i}`, { form: `chunk ${i}` });
      store.recordInitialLearning({ observationId: `pl-${i}`, chunkId: `c${i}` });
    }

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;

    // 人为制造 3 条错误日志。
    const { recordErrorLog } = await import("../src/error-log");
    for (let i = 0; i < ERROR_DIGEST_THRESHOLD; i += 1) {
      recordErrorLog({
        db,
        clock,
        language: "en",
        topicId: plan.topicId,
        originalText: `wrong ${i}`,
        quote: `wrong ${i}`,
        phenomenon: `问题 ${i}`,
        correction: `答案 ${i}`,
      });
    }

    const digests = renderPendingSystemDigests({ db, clock, language: "en" });

    expect(digests).toHaveLength(1);
    expect(digests[0]!.errorCount).toBe(ERROR_DIGEST_THRESHOLD);
    expect(digests[0]!.text).toContain(`错误累计已达 ${ERROR_DIGEST_THRESHOLD} 条，提前发送小结。`);
  });

  it("does not render a digest twice for the same topic", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    insertChunk(db, "c1", { form: "look for" });
    insertChunk(db, "c2", { form: "see you around" });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "c1" });
    store.recordInitialLearning({ observationId: "pl-2", chunkId: "c2" });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;

    clock.set(clock.now() + TOPIC_IDLE_MS + MINUTE);

    const first = renderPendingSystemDigests({ db, clock, language: "en" });
    expect(first).toHaveLength(1);

    markTopicDigestSent(db, plan.topicId, clock.now());

    const second = renderPendingSystemDigests({ db, clock, language: "en" });
    expect(second).toHaveLength(0);
  });

  it("scopes digests to the requested language", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    insertChunk(db, "c1", { form: "look for", language: "en" });
    insertChunk(db, "c2", { form: "see you around", language: "en" });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "c1" });
    store.recordInitialLearning({ observationId: "pl-2", chunkId: "c2" });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;
    clock.set(clock.now() + TOPIC_IDLE_MS + MINUTE);

    expect(renderPendingSystemDigests({ db, clock, language: "ja" })).toHaveLength(0);
    expect(renderPendingSystemDigests({ db, clock, language: "en" })).toHaveLength(1);
  });

  it("does not render a digest for a fresh open topic with no errors", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    insertChunk(db, "c1", { form: "look for" });
    insertChunk(db, "c2", { form: "see you around" });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "c1" });
    store.recordInitialLearning({ observationId: "pl-2", chunkId: "c2" });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    ambush.planAmbushTopic("en")!;

    const digests = renderPendingSystemDigests({ db, clock, language: "en" });
    expect(digests).toHaveLength(0);
  });
});
