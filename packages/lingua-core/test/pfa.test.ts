import { describe, expect, it } from "vitest";
import { DEFAULT_PFA_PARAMS, pfaMastery } from "../src/index";
import { DAY, insertChunk, makeHarness, T0 } from "./helpers";

describe("PFA (Pavlik, Cen & Koedinger 2009)", () => {
  it("reproduces the model predictions of the paper's Table 1 example", () => {
    // Table 1 (student a51864, KC S44IdentifyGCFonenumbermultipleofother)：
    // 论文给出的逐行 Model Pred. 是该行作答前、基于当时 (s, f) 的预测。
    const paperRows: { correct: 0 | 1; prediction: number }[] = [
      { correct: 1, prediction: 0.6058313 },
      { correct: 0, prediction: 0.6351781 },
      { correct: 1, prediction: 0.6089495 },
      { correct: 1, prediction: 0.6382028 },
      { correct: 1, prediction: 0.6664663 },
    ];

    let successes = 0;
    let failures = 0;
    for (const row of paperRows) {
      const predicted = pfaMastery(DEFAULT_PFA_PARAMS, successes, failures);
      expect(Math.abs(predicted - row.prediction)).toBeLessThan(1e-6);
      if (row.correct === 1) successes += 1;
      else failures += 1;
    }
  });

  it("defaults are the parameters implied by the paper's Table 1 example fit", () => {
    // 由论文示例值反解：β = logit(p₀)，γ = logit(p₁) − logit(p₀)，ρ = logit(p₂) − logit(p₁)。
    expect(DEFAULT_PFA_PARAMS.beta).toBeCloseTo(0.4298226, 6);
    expect(DEFAULT_PFA_PARAMS.gamma).toBeCloseTo(0.1246736, 6);
    expect(DEFAULT_PFA_PARAMS.rho).toBeCloseTo(-0.1115975, 6);
  });

  it("success raises mastery and failure lowers it, monotonically", () => {
    const base = pfaMastery(DEFAULT_PFA_PARAMS, 2, 1);
    expect(pfaMastery(DEFAULT_PFA_PARAMS, 3, 1)).toBeGreaterThan(base);
    expect(pfaMastery(DEFAULT_PFA_PARAMS, 2, 2)).toBeLessThan(base);
  });
});

describe("PFA projection from the event log", () => {
  it("counts matrix-derived outcomes per skill: independent success/failure, assisted failure only", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");

    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "…",
    });
    store.recordEvidence({
      observationId: "obs-2",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "wrong",
      confidence: 0.95,
      quote: "…",
    });
    store.recordEvidence({
      observationId: "obs-3",
      chunkId: "chunk-1",
      assistance: "assisted",
      outcome: "wrong",
      confidence: 0.95,
      quote: "…",
    });
    // 辅助×正确与未产出都不是掌握度证据。
    store.recordEvidence({
      observationId: "obs-4",
      chunkId: "chunk-1",
      assistance: "assisted",
      outcome: "correct",
      confidence: 0.95,
      quote: "…",
    });
    store.recordEvidence({
      observationId: "obs-5",
      chunkId: "chunk-1",
      outcome: "not-produced",
      confidence: 0.95,
      quote: "…",
    });

    const skill = store
      .currentBeliefAt(T0 + DAY)
      .skills.find((s) => s.skillId === "chunk-1");
    expect(skill).toBeDefined();
    expect(skill!.successes).toBe(1);
    expect(skill!.failures).toBe(2);
    expect(skill!.mastery).toBeCloseTo(
      pfaMastery(DEFAULT_PFA_PARAMS, 1, 2),
      10,
    );
  });

  it("ignores low-confidence evidence and follows corrections on replay", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.3,
      quote: "…",
    });

    expect(store.currentBeliefAt(T0 + DAY).skills).toHaveLength(0);

    // 同一 observation 的纠正版本生效后只按有效版本计数一次。
    clock.set(T0 + DAY);
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "wrong",
      confidence: 1,
      quote: "…",
      judge: { name: "human-review", version: "1" },
    });

    const skill = store
      .currentBeliefAt(T0 + 2 * DAY)
      .skills.find((s) => s.skillId === "chunk-1");
    expect(skill!.successes).toBe(0);
    expect(skill!.failures).toBe(1);
  });

  it("answers both as-of modes: as-known hides future corrections, current-belief applies them", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "…",
      occurredAt: T0,
    });

    clock.set(T0 + 2 * DAY);
    store.voidObservation({ observationId: "obs-1", reason: "误判" });

    // 当时所知（撤销记录之前）：成功仍在。
    const asKnown = store
      .asKnownAt(T0 + DAY)
      .skills.find((s) => s.skillId === "chunk-1");
    expect(asKnown!.successes).toBe(1);
    // 当前认知：任何时间被撤销者都排除。
    expect(store.currentBeliefAt(T0 + DAY).skills).toHaveLength(0);
  });
});
