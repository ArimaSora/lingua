import { describe, expect, it } from "vitest";
import {
  AMBUSH_REPEAT_WINDOW_MS,
  MAX_AMBUSH_CHUNKS,
  MAX_BURIALS_IN_WINDOW,
  MAX_TOPICS_PER_DAY,
  openAmbush,
  STALE_TOPIC_MS,
} from "../src/index";
import {
  DAY,
  HOUR,
  insertAmbushPlacement,
  insertAmbushTopic,
  insertChunk,
  insertLesson,
  makeHarness,
  T0,
} from "./helpers";

// 埋伏调度（issue #7，docs/specs/mvp.md 双联系人与主动性）：候选池 = 到期语块，
// 事件驱动有料才起（无死配额）；每话题埋 2–4 个到期语块、同语块 48h 内最多埋
// 2 次、未命中回炉重排；每日主动起话题至多 3 次。不泄题硬规则（ADR-0013）：
// 话题生成提示不得包含目标语块形式或直译。

function makeDue(
  harness: ReturnType<typeof makeHarness>,
  ids: string[],
  options: { prelearnedAt?: number; forms?: Record<string, string>; sources?: Record<string, string> } = {},
): void {
  const { db, store } = harness;
  for (const id of ids) {
    insertChunk(db, id, {
      form: options.forms?.[id],
      sourceContentId: options.sources?.[id],
    });
    // 首次到期 = 预学次日（ADR-0016）。
    store.recordInitialLearning({
      observationId: `prelearn-${id}`,
      chunkId: id,
      occurredAt: options.prelearnedAt ?? T0,
    });
  }
}

describe("planAmbushTopic：候选池 → 话题计划", () => {
  it("plans a topic over 2+ due chunks, most overdue first, capped at 4", () => {
    const harness = makeHarness();
    makeDue(harness, ["c1", "c2", "c3", "c4", "c5"]);
    const ambush = openAmbush({ db: harness.db, clock: harness.clock });

    harness.clock.set(T0 + 2 * DAY);
    const plan = ambush.planAmbushTopic("en");

    expect(plan).not.toBeNull();
    expect(plan!.chunkIds).toHaveLength(MAX_AMBUSH_CHUNKS);
    expect(plan!.chunkIds).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("returns null when the pool has fewer than 2 due chunks (有料才起，无死配额)", () => {
    const harness = makeHarness();
    makeDue(harness, ["c1"]);
    const ambush = openAmbush({ db: harness.db, clock: harness.clock });

    harness.clock.set(T0 + 2 * DAY);
    expect(ambush.planAmbushTopic("en")).toBeNull();
  });

  it("returns null when nothing is due yet", () => {
    const harness = makeHarness();
    makeDue(harness, ["c1", "c2"]);
    const ambush = openAmbush({ db: harness.db, clock: harness.clock });

    // 预学次日才到期：当天不起。
    expect(ambush.planAmbushTopic("en")).toBeNull();
  });

  it("excludes a chunk buried twice within 48h, re-admits it after the window (回炉重排)", () => {
    const harness = makeHarness();
    makeDue(harness, ["c1", "c2", "c3"]);
    const { db, clock } = harness;
    const ambush = openAmbush({ db, clock });

    // c3 在 48h 窗内已被埋 2 次。
    insertAmbushTopic(db, "topic-1", { status: "resolved" });
    insertAmbushPlacement(db, "p1", { chunkId: "c3", buriedAt: T0 + DAY - HOUR });
    insertAmbushPlacement(db, "p2", { chunkId: "c3", buriedAt: T0 + 2 * DAY - HOUR });
    // c2 的 2 次都在 48h 窗外，重新可埋。
    insertAmbushPlacement(db, "p3", { chunkId: "c2", buriedAt: T0 - 2 * DAY });
    insertAmbushPlacement(db, "p4", { chunkId: "c2", buriedAt: T0 - DAY });

    clock.set(T0 + 2 * DAY);
    const plan = ambush.planAmbushTopic("en");

    expect(plan).not.toBeNull();
    expect(plan!.chunkIds).toEqual(["c1", "c2"]);
    expect(plan!.chunkIds).not.toContain("c3");
    expect(MAX_BURIALS_IN_WINDOW).toBe(2);
    expect(AMBUSH_REPEAT_WINDOW_MS).toBe(2 * DAY);
  });

  it("starts no more than 3 topics per day, counting only same-day topics", () => {
    const harness = makeHarness();
    makeDue(harness, ["c1", "c2"]);
    const { db, clock } = harness;
    const ambush = openAmbush({ db, clock });

    // 昨天的话题不计入今日额度。
    insertAmbushTopic(db, "old-1", { status: "resolved", openedAt: T0 - DAY });
    insertAmbushTopic(db, "old-2", { status: "resolved", openedAt: T0 - DAY });
    insertAmbushTopic(db, "old-3", { status: "resolved", openedAt: T0 - DAY });

    clock.set(T0 + 2 * DAY);
    expect(ambush.planAmbushTopic("en")).not.toBeNull();

    // 今日已起 3 个 → 不再起。
    for (let i = 0; i < MAX_TOPICS_PER_DAY; i += 1) {
      insertAmbushTopic(db, `today-${i}`, {
        status: "resolved",
        openedAt: T0 + 2 * DAY + i * HOUR,
      });
    }
    clock.set(T0 + 2 * DAY + 4 * HOUR);
    expect(ambush.planAmbushTopic("en")).toBeNull();
    expect(MAX_TOPICS_PER_DAY).toBe(3);
  });

  it("leaves a fresh open topic alone and starts no new one", () => {
    const harness = makeHarness();
    makeDue(harness, ["c1", "c2"]);
    const { db, clock } = harness;
    const ambush = openAmbush({ db, clock });

    insertAmbushTopic(db, "open-1", { status: "open", openedAt: T0 + 2 * DAY - HOUR });
    clock.set(T0 + 2 * DAY);

    expect(ambush.planAmbushTopic("en")).toBeNull();
    const row = db
      .prepare("SELECT status FROM ambush_topics WHERE id = 'open-1'")
      .get() as { status: string };
    expect(row.status).toBe("open");
  });

  it("closes a stale open topic (no response within 24h) as missed and emits response metric 0", () => {
    const harness = makeHarness();
    makeDue(harness, ["c1", "c2"]);
    const { db, clock } = harness;
    const ambush = openAmbush({ db, clock });

    insertAmbushTopic(db, "stale-1", { status: "open", openedAt: T0 + DAY });
    insertAmbushPlacement(db, "sp1", { topicId: "stale-1", chunkId: "c1", buriedAt: T0 + DAY });

    clock.set(T0 + DAY + STALE_TOPIC_MS + HOUR);
    const plan = ambush.planAmbushTopic("en");

    // 超期话题被关闭：placement 记 missed（回炉），话题记 stale。
    const topic = db
      .prepare("SELECT status, closed_at FROM ambush_topics WHERE id = 'stale-1'")
      .get() as { status: string; closed_at: number };
    expect(topic.status).toBe("stale");
    const placement = db
      .prepare("SELECT outcome, resolved_at FROM ambush_placements WHERE id = 'sp1'")
      .get() as { outcome: string; resolved_at: number };
    expect(placement.outcome).toBe("missed");

    const metrics = db
      .prepare("SELECT metric_name, value FROM metric_events ORDER BY metric_name")
      .all() as unknown as { metric_name: string; value: number }[];
    expect(metrics).toEqual([
      { metric_name: "ambush-hit", value: 0 },
      { metric_name: "topic-response", value: 0 },
    ]);

    // 关闭后有料：c1 回炉（48h 内只埋过 1 次）→ 可以起新话题。
    expect(plan).not.toBeNull();
    expect(plan!.chunkIds).toContain("c1");
    expect(STALE_TOPIC_MS).toBe(DAY);
  });
});

describe("planAmbushTopic：不泄题硬规则（ADR-0013）", () => {
  it("builds a topic prompt that contains neither canonical forms nor variants of the targets", () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    insertLesson(db, "lesson-1", { title: "First contact：打招呼与开场", hook: "认识人的第一句话" });
    insertChunk(db, "c1", {
      form: "how's it going",
      variants: ["how's it goin"],
      sourceContentId: "lesson-1",
    });
    insertChunk(db, "c2", { form: "nice to meet you", sourceContentId: "lesson-1" });
    store.recordInitialLearning({ observationId: "pl-c1", chunkId: "c1" });
    store.recordInitialLearning({ observationId: "pl-c2", chunkId: "c2" });
    const ambush = openAmbush({ db, clock });

    clock.set(T0 + 2 * DAY);
    const plan = ambush.planAmbushTopic("en");

    expect(plan).not.toBeNull();
    const prompt = plan!.prompt.toLowerCase();
    for (const leaked of ["how's it going", "how's it goin", "nice to meet you"]) {
      expect(prompt).not.toContain(leaked);
    }
    // 语义锚定走场景线索（课标题/钩子），不走形式。
    expect(plan!.prompt).toContain("First contact：打招呼与开场");
    expect(plan!.scenarios.length).toBeGreaterThan(0);
  });

  it("refuses to plan when a scenario hint would leak a target form", () => {
    const harness = makeHarness();
    const { db, clock } = harness;
    // 病理数据：课标题本身含有语块形式——守卫必须拦截而不是泄进提示。
    insertLesson(db, "lesson-1", { title: "look for 用法", hook: "找东西" });
    makeDue(harness, ["c1", "c2"], {
      forms: { c1: "look for", c2: "thanks a lot" },
      sources: { c1: "lesson-1", c2: "lesson-1" },
    });
    const ambush = openAmbush({ db, clock });

    clock.set(T0 + 2 * DAY);
    expect(() => ambush.planAmbushTopic("en")).toThrow(/泄题|leak/i);
  });
});
