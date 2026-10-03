import { describe, expect, it } from "vitest";
import { renderDigest } from "../src/index";
import { DAY, insertChunk, insertFact, makeHarness, T0 } from "./helpers";

describe("renderDigest (ADR-0002/0017 三段式)", () => {
  it("renders 埋伏目标 / 近期弱点 / 角色须知 from learner state and curated facts", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-due", { form: "look ___ up" });
    insertChunk(db, "chunk-weak", { form: "take off" });
    insertChunk(db, "chunk-future", { form: "put up with" });
    insertFact(db, "fact-1", { fact: "用户在学 agent 方向的英语" });

    // 到期语块：预学完成于 T0，首次到期 T0+1 天。
    store.recordInitialLearning({ observationId: "prelearn-1", chunkId: "chunk-due" });
    // 弱点：一次独立尝试失败。
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-weak",
      assistance: "none",
      outcome: "wrong",
      confidence: 0.95,
      quote: "I took off it",
    });
    // 未到期语块：预学完成于 10 天后（补录），不得入选。
    store.recordInitialLearning({
      observationId: "prelearn-2",
      chunkId: "chunk-future",
      occurredAt: T0 + 10 * DAY,
    });

    clock.set(T0 + 2 * DAY);
    const digest = renderDigest({ db, clock, language: "en" });

    expect(digest.text).toContain("埋伏目标");
    expect(digest.text).toContain("近期弱点");
    expect(digest.text).toContain("角色须知");
    expect(digest.text).toContain("look ___ up（到期 2026-01-02）");
    expect(digest.text).toMatch(/take off（掌握 \d+%）/);
    expect(digest.text).toContain("用户在学 agent 方向的英语");
    expect(digest.text).not.toContain("put up with");
    expect(digest.tokens).toBeLessThanOrEqual(300);
    expect(digest.truncated).toBe(false);
  });

  it("orders ambush targets by due date and weaknesses by mastery", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-a", { form: "form a" });
    insertChunk(db, "chunk-b", { form: "form b" });
    insertChunk(db, "chunk-c", { form: "form c" });
    insertChunk(db, "chunk-d", { form: "form d" });

    store.recordInitialLearning({ observationId: "pl-a", chunkId: "chunk-a" });
    store.recordInitialLearning({
      observationId: "pl-b",
      chunkId: "chunk-b",
      occurredAt: T0 - 5 * DAY,
    });
    // chunk-b 到期更早（T0-4 天），应排在 chunk-a（T0+1 天）之前。

    store.recordEvidence({
      observationId: "obs-c",
      chunkId: "chunk-c",
      assistance: "none",
      outcome: "wrong",
      confidence: 0.95,
      quote: "…",
    });
    store.recordEvidence({
      observationId: "obs-d",
      chunkId: "chunk-d",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "…",
    });
    // chunk-c（0 成 1 败）掌握度低于 chunk-d（1 成 0 败）。

    clock.set(T0 + 2 * DAY);
    const digest = renderDigest({ db, clock, language: "en" });

    const ambushSection = digest.text.split("近期弱点：")[0]!;
    expect(ambushSection.indexOf("form b")).toBeLessThan(ambushSection.indexOf("form a"));
    const weaknessSection = digest.text.split("近期弱点：")[1]!;
    expect(weaknessSection.indexOf("form c")).toBeLessThan(weaknessSection.indexOf("form d"));
  });

  it("drops lowest-priority sections first when over budget, deterministically", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-due", { form: "look ___ up" });
    insertChunk(db, "chunk-weak", { form: "take off" });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "chunk-due" });
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-weak",
      assistance: "none",
      outcome: "wrong",
      confidence: 0.95,
      quote: "…",
    });
    for (let i = 0; i < 5; i += 1) {
      insertFact(db, `fact-${i}`, {
        fact: "很长的策展事实".repeat(40),
        createdAt: T0 + i,
      });
    }

    clock.set(T0 + 2 * DAY);
    const first = renderDigest({ db, clock, language: "en" });
    const second = renderDigest({ db, clock, language: "en" });

    expect(first.tokens).toBeLessThanOrEqual(300);
    expect(first.truncated).toBe(true);
    // 角色须知优先级最低：先被裁掉；埋伏目标与近期弱点保留。
    expect(first.text).not.toContain("角色须知");
    expect(first.text).toContain("埋伏目标");
    expect(first.text).toContain("近期弱点");
    // 确定性：同样输入渲染两次完全一致。
    expect(second.text).toBe(first.text);
  });

  it("hard-truncates a single oversized item instead of dropping it", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-huge", { form: `x`.repeat(1500) });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "chunk-huge" });

    clock.set(T0 + 2 * DAY);
    const digest = renderDigest({ db, clock, language: "en" });

    expect(digest.tokens).toBeLessThanOrEqual(300);
    expect(digest.truncated).toBe(true);
    expect(digest.text).toContain("埋伏目标");
    expect(digest.text).toContain("…");
  });

  it("returns an empty digest when there is nothing to say", () => {
    const { db, clock } = makeHarness();
    clock.set(T0 + DAY);
    const digest = renderDigest({ db, clock, language: "en" });
    expect(digest.text).toBe("");
    expect(digest.tokens).toBe(0);
    expect(digest.truncated).toBe(false);
  });

  it("scopes selection to the requested language", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-ja", { form: "猫をかぶる", language: "ja" });
    insertFact(db, "fact-ja", { fact: "日本語の事実", language: "ja" });
    store.recordInitialLearning({ observationId: "pl-1", chunkId: "chunk-ja" });

    clock.set(T0 + 2 * DAY);
    const digest = renderDigest({ db, clock, language: "en" });
    expect(digest.text).toBe("");

    const ja = renderDigest({ db, clock, language: "ja" });
    expect(ja.text).toContain("猫をかぶる");
    expect(ja.text).toContain("日本語の事実");
  });
});
