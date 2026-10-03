import { describe, expect, it } from "vitest";
import { defaultParams } from "../src/index";
import { DAY, insertChunk, makeHarness, T0 } from "./helpers";

describe("projection (as-of 双模式)", () => {
  it("projects a high-confidence independent production into memory state", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
    });

    for (const projection of [store.asKnownAt(T0 + DAY), store.currentBeliefAt(T0 + DAY)]) {
      const chunk = projection.chunks.find((c) => c.chunkId === "chunk-1");
      expect(chunk).toBeDefined();
      expect(chunk!.reps).toBe(1);
      expect(chunk!.state).not.toBe("new");
      expect(chunk!.lastEventType).toBe("independent-production");
      expect(chunk!.admittedEvidence).toBe(1);
    }
  });

  it("acceptance 1: low-confidence observation does not affect state after replay", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.3,
      quote: "I looked it up",
    });

    for (const projection of [store.asKnownAt(T0 + DAY), store.currentBeliefAt(T0 + DAY)]) {
      expect(projection.chunks.find((c) => c.chunkId === "chunk-1")).toBeUndefined();
    }
  });

  it("acceptance 1: a later qualified judgment of the same observation updates state exactly once", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.3,
      quote: "I looked it up",
    });

    clock.advance(DAY);
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
      judge: { name: "jev", version: "0.5.0" },
    });

    const chunk = store
      .currentBeliefAt(T0 + 2 * DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(chunk).toBeDefined();
    expect(chunk!.reps).toBe(1);
    expect(chunk!.admittedEvidence).toBe(1);
  });

  it("matrix admission: assisted production and no-evidence never touch state, even at full confidence", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");
    insertChunk(db, "chunk-2");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "assisted",
      outcome: "correct",
      confidence: 1,
      quote: "looked it up (after hint)",
    });
    store.recordEvidence({
      observationId: "obs-2",
      chunkId: "chunk-2",
      outcome: "not-produced",
      confidence: 1,
      quote: "…",
    });

    const projection = store.currentBeliefAt(T0 + DAY);
    expect(projection.chunks).toHaveLength(0);
  });

  it("replay is deterministic: same event log projects to identical state", () => {
    const build = () => {
      const { db, clock, store } = makeHarness();
      insertChunk(db, "chunk-1");
      for (let i = 0; i < 5; i += 1) {
        store.recordEvidence({
          observationId: `obs-${i}`,
          chunkId: "chunk-1",
          assistance: "none",
          outcome: i % 2 === 0 ? "correct" : "wrong",
          confidence: 0.95,
          quote: `use ${i}`,
        });
        clock.advance(2 * DAY);
      }
      return store.currentBeliefAt(T0 + 30 * DAY);
    };

    expect(build()).toEqual(build());
  });

  it("acceptance 2: correcting an observation does not double count and does not leak into as-of history", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");

    // t0：判分器判为独立产出。
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I look up it",
      occurredAt: T0,
    });

    // t2：人工抽检纠正 —— 同一 observation 追加新版本，观测时刻不变。
    clock.set(T0 + 2 * DAY);
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "wrong",
      confidence: 1,
      quote: "I look up it",
      occurredAt: T0,
      judge: { name: "human-review", version: "1" },
    });

    // 当时所知（纠正发生前）：仍是独立产出 —— 未来信息不泄漏。
    const beforeCorrection = store
      .asKnownAt(T0 + DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(beforeCorrection!.lastEventType).toBe("independent-production");
    expect(beforeCorrection!.reps).toBe(1);

    // 当前认知：纠正生效，且同一观测只计一次。
    const now = store
      .currentBeliefAt(T0 + DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(now!.lastEventType).toBe("independent-attempt-failed");
    expect(now!.reps).toBe(1);
    expect(now!.admittedEvidence).toBe(1);

    // 当时所知（纠正发生后）：与当前认知一致。
    const afterCorrection = store
      .asKnownAt(T0 + 3 * DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(afterCorrection!.lastEventType).toBe("independent-attempt-failed");
  });

  it("distinct observations each count once", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");

    for (const [index, observationId] of ["obs-1", "obs-2"].entries()) {
      store.recordEvidence({
        observationId,
        chunkId: "chunk-1",
        assistance: "none",
        outcome: "correct",
        confidence: 0.95,
        quote: `use ${index}`,
      });
      clock.advance(3 * DAY);
    }

    const chunk = store
      .currentBeliefAt(T0 + 30 * DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(chunk!.reps).toBe(2);
    expect(chunk!.admittedEvidence).toBe(2);
  });

  it("as-known projects with the parameter version of the time, current-belief with the current one", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
    });
    const asRecorded = store.currentBeliefAt(T0 + DAY).paramsVersion;

    clock.set(T0 + 2 * DAY);
    db.prepare(
      "INSERT INTO param_snapshots (id, user_id, language, params, created_at) VALUES (?, 'local', '*', ?, ?)",
    ).run(
      "params-v2",
      JSON.stringify({ ...defaultParams(), confidenceThreshold: 0.9 }),
      clock.now(),
    );

    expect(store.asKnownAt(T0 + DAY).paramsVersion).toBe(asRecorded);
    expect(store.currentBeliefAt(T0 + DAY).paramsVersion).toBe("params-v2");
  });
});

describe("initial-learning (ADR-0016)", () => {
  it("creates a new-state card due the day after pre-learning, without rating it", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordInitialLearning({ observationId: "prelearn-1", chunkId: "chunk-1" });

    const chunk = store
      .currentBeliefAt(T0 + DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(chunk).toBeDefined();
    expect(chunk!.state).toBe("new");
    expect(chunk!.reps).toBe(0);
    expect(chunk!.lastReviewAt).toBeNull();
    // 首次到期 = 预学次日。
    expect(chunk!.dueAt).toBe(T0 + DAY);
    expect(chunk!.lastEventType).toBe("initial-learning");
    // 不冒充成功回忆：不计入有效回忆证据。
    expect(chunk!.admittedEvidence).toBe(0);
  });

  it("does not update mastery (no PFA entry) and does not touch an existing card", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordInitialLearning({ observationId: "prelearn-1", chunkId: "chunk-1" });

    // initial-learning 不更新掌握度：没有任何 PFA 证据。
    expect(store.currentBeliefAt(T0 + DAY).skills).toHaveLength(0);

    // 首次 FSRS 评分来自首次真实回忆事件，不来自预学。
    clock.set(T0 + 2 * DAY);
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I looked it up",
    });

    const afterRecall = store
      .currentBeliefAt(T0 + 3 * DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(afterRecall!.reps).toBe(1);
    expect(afterRecall!.state).not.toBe("new");

    // 预学之后再来的 initial-learning（如重复完成课包）不重置卡片。
    clock.set(T0 + 4 * DAY);
    store.recordInitialLearning({ observationId: "prelearn-2", chunkId: "chunk-1" });
    const retrained = store
      .currentBeliefAt(T0 + 5 * DAY)
      .chunks.find((c) => c.chunkId === "chunk-1");
    expect(retrained!.reps).toBe(1);
    expect(retrained!.lastEventType).toBe("independent-production");
  });

  it("voiding the pre-learning observation removes the card on replay", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordInitialLearning({ observationId: "prelearn-1", chunkId: "chunk-1" });

    clock.set(T0 + DAY);
    store.voidObservation({ observationId: "prelearn-1", reason: "误记" });

    expect(store.currentBeliefAt(T0 + 2 * DAY).chunks).toHaveLength(0);
    // 当时所知（撤销前）仍可见。
    expect(store.asKnownAt(T0 + 12 * 60 * 60 * 1000).chunks).toHaveLength(1);
  });
});
