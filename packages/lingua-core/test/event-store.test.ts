import { describe, expect, it } from "vitest";
import { defaultParams } from "../src/index";
import { DAY, insertChunk, makeHarness, T0 } from "./helpers";

describe("recordEvidence", () => {
  it.each([
    {
      assistance: "none",
      outcome: "correct",
      eventType: "independent-production",
      fsrsRating: "good",
      pfaOutcome: "success",
      applied: true,
    },
    {
      assistance: "none",
      outcome: "wrong",
      eventType: "independent-attempt-failed",
      fsrsRating: "again",
      pfaOutcome: "failure",
      applied: true,
    },
    {
      assistance: "assisted",
      outcome: "correct",
      eventType: "assisted-production",
      fsrsRating: null,
      pfaOutcome: null,
      applied: false,
    },
    {
      assistance: "assisted",
      outcome: "wrong",
      eventType: "assisted-attempt-failed",
      fsrsRating: null,
      pfaOutcome: "failure",
      // 辅助×失败只记 PFA 不记 FSRS（ADR-0013）；PFA 是状态消费者，故 applied = true。
      applied: true,
    },
  ])(
    "derives $eventType from $assistance × $outcome (ADR-0013 matrix)",
    ({ assistance, outcome, eventType, fsrsRating, pfaOutcome, applied }) => {
      const { db, store } = makeHarness();
      insertChunk(db, "chunk-1");

      const event = store.recordEvidence({
        observationId: "obs-1",
        chunkId: "chunk-1",
        assistance: assistance as "none" | "assisted",
        outcome: outcome as "correct" | "wrong",
        confidence: 0.95,
        quote: "I looked it up",
      });

      expect(event.eventType).toBe(eventType);
      expect(event.fsrsRating).toBe(fsrsRating);
      expect(event.pfaOutcome).toBe(pfaOutcome);
      expect(event.applied).toBe(applied);
    },
  );

  it.each([undefined, "none", "assisted"] as const)(
    "derives no-evidence from not-produced regardless of assistance (%s)",
    (assistance) => {
      const { db, store } = makeHarness();
      insertChunk(db, "chunk-1");

      const event = store.recordEvidence({
        observationId: "obs-1",
        chunkId: "chunk-1",
        outcome: "not-produced",
        ...(assistance === undefined ? {} : { assistance }),
        confidence: 0.95,
        quote: "…",
      });

      // 未产出永不记失败（ADR-0013）：不进 FSRS 也不进 PFA。
      expect(event.eventType).toBe("no-evidence");
      expect(event.fsrsRating).toBeNull();
      expect(event.pfaOutcome).toBeNull();
      expect(event.applied).toBe(false);
    },
  );

  it("marks low-confidence evidence as not applied (audit only)", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");

    const event = store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.3,
      quote: "I looked it up",
    });

    expect(event.eventType).toBe("independent-production");
    expect(event.applied).toBe(false);
  });

  it("stamps ids, times and language from the clock port and chunk", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1", { language: "en" });

    const event = store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
      judge: { name: "jev", version: "0.4.2" },
    });

    expect(event.eventId).not.toHaveLength(0);
    expect(event.occurredAt).toBe(T0);
    expect(event.recordedAt).toBe(T0);
    expect(event.language).toBe("en");
    expect(event.judgeName).toBe("jev");
    expect(event.judgeVersion).toBe("0.4.2");
    expect(event.paramsVersion).not.toHaveLength(0);

    clock.advance(1000);
    const second = store.recordEvidence({
      observationId: "obs-2",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "again",
    });
    expect(second.eventId > event.eventId).toBe(true);
    expect(second.recordedAt).toBe(T0 + 1000);
  });

  it("rejects evidence for an unknown chunk", () => {
    const { store } = makeHarness();
    expect(() =>
      store.recordEvidence({
        observationId: "obs-1",
        chunkId: "missing",
        assistance: "none",
        outcome: "correct",
        confidence: 0.95,
        quote: "…",
      }),
    ).toThrow(/missing/);
  });

  it("derives applied from the parameter snapshot the event references", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");

    clock.set(T0 + DAY);
    db.prepare(
      "INSERT INTO param_snapshots (id, user_id, language, params, created_at) VALUES (?, 'local', '*', ?, ?)",
    ).run(
      "params-v2",
      JSON.stringify({ ...defaultParams(), confidenceThreshold: 0.9 }),
      clock.now(),
    );

    const event = store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.8,
      quote: "I looked it up",
    });

    expect(event.paramsVersion).toBe("params-v2");
    expect(event.applied).toBe(false);
  });
});

describe("voidObservation", () => {
  it("void removes the observation from state, entering the timeline at recorded_at", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
      occurredAt: T0,
    });

    clock.set(T0 + 2 * DAY);
    const voidEvent = store.voidObservation({
      observationId: "obs-1",
      reason: "误判：该句是复述不是产出",
    });
    expect(voidEvent.eventType).toBe("void");
    expect(voidEvent.voidsEventId).not.toBeNull();
    expect(voidEvent.recordedAt).toBe(T0 + 2 * DAY);

    // 当时所知（撤销记录之前）：状态不受未来撤销影响。
    const before = store
      .asKnownAt(T0 + DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(before).toBeDefined();
    expect(before!.lastEventType).toBe("independent-production");

    // 当时所知（撤销记录之后）：效果消失。
    expect(store.asKnownAt(T0 + 3 * DAY).chunks).toHaveLength(0);

    // 当前认知：排除任何时间被撤销者。
    expect(store.currentBeliefAt(T0 + DAY).chunks).toHaveLength(0);
  });

  it("a re-judgment after void becomes effective again", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
      occurredAt: T0,
    });

    clock.set(T0 + DAY);
    store.voidObservation({ observationId: "obs-1", reason: "judge bug" });

    clock.set(T0 + 2 * DAY);
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
      occurredAt: T0,
      judge: { name: "jev", version: "0.5.1" },
    });

    const chunk = store
      .currentBeliefAt(T0 + 3 * DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(chunk).toBeDefined();
    expect(chunk!.reps).toBe(1);
  });

  it("rejects voiding an unknown observation", () => {
    const { store } = makeHarness();
    expect(() =>
      store.voidObservation({ observationId: "nope", reason: "…" }),
    ).toThrow(/nope/);
  });
});

describe("recordInitialLearning (ADR-0016)", () => {
  it("records pre-learning completion as its own event type, not a recall success", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");

    const event = store.recordInitialLearning({
      observationId: "prelearn-1",
      chunkId: "chunk-1",
    });

    expect(event.eventType).toBe("initial-learning");
    expect(event.fsrsRating).toBeNull();
    expect(event.pfaOutcome).toBeNull();
    expect(event.confidence).toBeNull();
    expect(event.assistance).toBeNull();
    expect(event.outcome).toBeNull();
    // 初次学习参与状态（建立卡片与首次到期），applied 记录这一事实。
    expect(event.applied).toBe(true);
    expect(event.paramsVersion).not.toBeNull();
  });

  it("rejects initial learning for an unknown chunk", () => {
    const { store } = makeHarness();
    expect(() =>
      store.recordInitialLearning({ observationId: "prelearn-1", chunkId: "missing" }),
    ).toThrow(/missing/);
  });
});
