import { describe, expect, it } from "vitest";
import {
  AMBUSH_HIT_METRIC,
  AMBUSH_REPEAT_WINDOW_MS,
  createJudge,
  MAX_AMBUSH_CHUNKS,
  MAX_BURIALS_IN_WINDOW,
  MAX_TOPICS_PER_DAY,
  openAmbush,
  openBootstrap,
  STALE_TOPIC_MS,
  TOPIC_RESPONSE_METRIC,
} from "../src/index";
import type { UsageJudge, UsageVerdict } from "../src/index";
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

// 埋伏调度（issue #7/#8，docs/specs/mvp.md 双联系人与主动性）：候选池 = 到期语块，
// 事件驱动有料才起（无死配额）；每话题埋 2–4 个到期语块、同语块 48h 内最多埋
// 2 次、未命中回炉重排；判分闭环同时写入错误日志，供系统小结消费。
// 每日主动起话题至多 3 次。不泄题硬规则（ADR-0013）：
// 话题生成提示不得包含目标语块形式或直译。

function makeDue(
  harness: ReturnType<typeof makeHarness>,
  ids: string[],
  options: { prelearnedAt?: number; forms?: Record<string, string>; sources?: Record<string, string> } = {},
): void {
  const { db, store } = harness;
  for (const id of ids) {
    const chunkOptions: Parameters<typeof insertChunk>[2] = {};
    if (options.forms?.[id] !== undefined) chunkOptions.form = options.forms[id];
    if (options.sources?.[id] !== undefined) chunkOptions.sourceContentId = options.sources[id];
    insertChunk(db, id, chunkOptions);
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

function fakeUsageJudge(verdict: UsageVerdict): UsageJudge {
  return {
    name: "fake-usage",
    version: "0.1",
    async judgeUsage() {
      return verdict;
    },
  };
}

describe("埋伏闭环：Judge + 事件 + 状态（issue #7 验收）", () => {
  it("e2e: 课包预学 → 角色埋伏起话题 → 用户产出 → 事件记录 → 状态更新 → 再次到期后被复用", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    const bootstrap = openBootstrap({ db, clock });

    bootstrap.seedPack({
      id: "pack-e2e",
      language: "en",
      title: "E2E Pack",
      lessons: [
        {
          id: "lesson-e2e-1",
          title: "First contact：打招呼与开场",
          kind: "survival-chunks",
          hook: "认识人的第一句话",
          body: "A: Hi! How's it going? B: Nice to meet you.",
          chunks: [
            {
              form: "how's it going",
              chunkType: "collocation",
              cefr: "A1",
              variants: [],
              slotPattern: null,
              example: "How's it going?",
              intuition: "熟人见面时的轻松问候，相当于「最近怎么样」。",
            },
            {
              form: "nice to meet you",
              chunkType: "collocation",
              cefr: "A1",
              variants: [],
              slotPattern: null,
              example: "Nice to meet you!",
              intuition: "初次见面表示高兴，语气友好。",
            },
          ],
        },
      ],
    });

    const pushed = bootstrap.pushNextLesson("en")!;
    expect(pushed.chunkIds).toHaveLength(2);
    const chunkId = (
      db
        .prepare("SELECT id FROM chunks WHERE canonical_form = ?")
        .get("how's it going") as { id: string }
    ).id;
    expect(pushed.chunkIds).toContain(chunkId);
    bootstrap.completePreLearning("en");

    // 预学次日到期。
    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;
    expect(plan.chunkIds).toContain(chunkId);
    expect(plan.prompt.toLowerCase()).not.toContain("how's it going");

    const judge = createJudge({ db, usageJudge: fakeUsageJudge({ outcome: "correct", confidence: 0.92 }) });
    const resolved = await ambush.resolveTopic({
      topicId: plan.topicId,
      userText: "I'm doing great, how's it going with you?",
      judge,
      store,
    });

    const hit = resolved.placements.find((p) => p.chunkId === chunkId);
    expect(hit?.outcome).toBe("hit");

    // 事件记录：命中语块独立产出，未命中语块记 no-evidence。
    const events = db
      .prepare("SELECT event_type, outcome, assistance FROM events WHERE event_type != 'initial-learning' ORDER BY recorded_at, event_id")
      .all() as unknown as { event_type: string; outcome: string; assistance: string | null }[];
    expect(events).toEqual([
      { event_type: "independent-production", outcome: "correct", assistance: "none" },
      { event_type: "no-evidence", outcome: "not-produced", assistance: null },
    ]);

    // 状态更新：chunk 被 FSRS 推进，掌握度变化。
    const after = store.currentBeliefAt(clock.now());
    const chunkAfter = after.chunks.find((c) => c.chunkId === chunkId)!;
    expect(chunkAfter.admittedEvidence).toBe(1);
    expect(chunkAfter.dueAt).toBeGreaterThan(clock.now());

    // 命中率与回应率落库。
    const metrics = db
      .prepare("SELECT metric_name, value FROM metric_events ORDER BY created_at, metric_name")
      .all() as unknown as { metric_name: string; value: number }[];
    expect(metrics).toContainEqual({ metric_name: AMBUSH_HIT_METRIC, value: 1 });
    expect(metrics).toContainEqual({ metric_name: TOPIC_RESPONSE_METRIC, value: 1 });

    // 推进到新的到期日，角色再次埋入同一语块。
    clock.set(chunkAfter.dueAt! + HOUR);
    const plan2 = ambush.planAmbushTopic("en")!;
    expect(plan2.chunkIds).toContain(chunkId);
  });

  it("用户用替代正确表达完成交流 = 未获得证据，状态不变、命中率下降（ADR-0013）", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    makeDue(harness, ["c1", "c2"], { forms: { c1: "look for", c2: "see you around" } });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;
    expect(plan.chunkIds).toContain("c1");

    const before = store.currentBeliefAt(clock.now());
    const chunkBefore = before.chunks.find((c) => c.chunkId === "c1")!;

    // 用户没用 look for，但用替代表达完成了交际。
    const judge = createJudge({ db, usageJudge: fakeUsageJudge({ outcome: "correct", confidence: 0.9 }) });
    const resolved = await ambush.resolveTopic({
      topicId: plan.topicId,
      userText: "I found a great article about agents.",
      judge,
      store,
    });

    const placement = resolved.placements.find((p) => p.chunkId === "c1")!;
    expect(placement.outcome).toBe("missed");
    expect(placement.verdict.outcome).toBe("not-produced");

    // 未获得证据：状态不变（dueAt 不变）。
    const after = store.currentBeliefAt(clock.now());
    const chunkAfter = after.chunks.find((c) => c.chunkId === "c1")!;
    expect(chunkAfter.dueAt).toBe(chunkBefore.dueAt);

    // 未获得证据：两个语块都记 no-evidence 事件，但不更新状态、不记失败。
    const nonInitial = db
      .prepare("SELECT event_type, outcome, assistance FROM events WHERE event_type != 'initial-learning' ORDER BY event_id")
      .all() as unknown as { event_type: string; outcome: string | null; assistance: string | null }[];
    expect(nonInitial).toEqual([
      { event_type: "no-evidence", outcome: "not-produced", assistance: null },
      { event_type: "no-evidence", outcome: "not-produced", assistance: null },
    ]);

    // 命中率下降：该语块的 ambush-hit = 0。
    const hits = db
      .prepare(
        "SELECT value FROM metric_events WHERE metric_name = ? AND json_extract(payload, '$.chunkId') = ?",
      )
      .all(AMBUSH_HIT_METRIC, "c1") as unknown as { value: number }[];
    expect(hits.map((r) => r.value)).toEqual([0]);
  });

  it("判分错误用法时写入错误日志，且错误日志不进入学习者状态（ADR-0009）", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    makeDue(harness, ["c1", "c2"], { forms: { c1: "look for", c2: "see you around" } });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;

    const before = store.currentBeliefAt(clock.now());
    const chunkBefore = before.chunks.find((c) => c.chunkId === "c1")!;

    // c1 被用户使用但用法错误。
    const judge = createJudge({ db, usageJudge: fakeUsageJudge({ outcome: "wrong", confidence: 0.85 }) });
    const resolved = await ambush.resolveTopic({
      topicId: plan.topicId,
      userText: "I look for my keys yesterday.",
      judge,
      store,
    });

    const placement = resolved.placements.find((p) => p.chunkId === "c1")!;
    expect(placement.outcome).toBe("missed");
    expect(placement.verdict.outcome).toBe("wrong");

    // 错误日志写入独立表，包含现象与参考答案。
    const errors = db
      .prepare("SELECT * FROM error_logs WHERE topic_id = ?")
      .all(plan.topicId) as unknown as {
      chunk_id: string;
      original_text: string;
      quote: string;
      phenomenon: string;
      correction: string;
    }[];
    expect(errors).toHaveLength(1);
    expect(errors[0]!.chunk_id).toBe("c1");
    expect(errors[0]!.quote).toBe("look for");
    expect(errors[0]!.phenomenon).toBeTruthy();
    expect(errors[0]!.correction).toContain("look for");

    // 错误用法仍按 ADR-0013 更新学习者状态（again / failure），
    // 但错误日志表本身不直接写入状态——状态只由 events 管线决定。
    const after = store.currentBeliefAt(clock.now());
    const chunkAfter = after.chunks.find((c) => c.chunkId === "c1")!;
    expect(chunkAfter.dueAt).not.toBe(chunkBefore.dueAt);
    expect(chunkAfter.lastEventType).toBe("independent-attempt-failed");
  });

  it("近期示范过目标语块时判对 = 辅助产出，命中记 0（ADR-0013 独立产出口径）", async () => {
    const harness = makeHarness();
    const { db, clock, store } = harness;
    makeDue(harness, ["c1", "c2"], { forms: { c1: "look for", c2: "see you around" } });

    clock.set(T0 + 2 * DAY);
    const ambush = openAmbush({ db, clock });
    const plan = ambush.planAmbushTopic("en")!;
    expect(plan.chunkIds).toContain("c1");

    // 用户用上了目标语块且判对，但近几轮角色示范过该形式（有辅助）。
    const judge = createJudge({
      db,
      usageJudge: fakeUsageJudge({ outcome: "correct", confidence: 0.95 }),
    });
    const resolved = await ambush.resolveTopic({
      topicId: plan.topicId,
      userText: "I am looking for a new podcast lately.",
      judge,
      store,
      exposedRecently: true,
    });

    const placement = resolved.placements.find((p) => p.chunkId === "c1")!;
    expect(placement.outcome).toBe("missed");

    // 命中率口径（ADR-0013）：辅助产出不是独立产出，只进分母（埋伏次数）。
    const hits = db
      .prepare(
        "SELECT value FROM metric_events WHERE metric_name = ? AND json_extract(payload, '$.chunkId') = ?",
      )
      .all(AMBUSH_HIT_METRIC, "c1") as unknown as { value: number }[];
    expect(hits.map((r) => r.value)).toEqual([0]);

    // 事件流同步为辅助产出：FSRS/PFA 均不更新（ADR-0013 矩阵）。
    const assisted = db
      .prepare(
        "SELECT event_type, outcome, assistance FROM events WHERE chunk_id = ? AND event_type != 'initial-learning'",
      )
      .all("c1") as unknown as { event_type: string; outcome: string; assistance: string | null }[];
    expect(assisted).toEqual([
      { event_type: "assisted-production", outcome: "correct", assistance: "assisted" },
    ]);
  });
});
