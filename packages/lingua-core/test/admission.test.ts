import { describe, expect, it } from "vitest";
import {
  FakeClock,
  migrate,
  openAdmission,
  openChunkStore,
  openDatabase,
  openEventStore,
} from "../src/index";
import { DAY, HOUR, insertChunk, T0 } from "./helpers";

// 测试接缝：lingua-core 包边界（openAdmission 公开接口）；时钟端口注入 FakeClock。
function makeAdmission(start: number = T0) {
  const db = openDatabase(":memory:");
  migrate(db);
  const clock = new FakeClock(start);
  const admission = openAdmission({ db, clock, language: "en" });
  const chunks = openChunkStore({ db, clock });
  const store = openEventStore({ db, clock });
  return { db, clock, admission, chunks, store };
}

describe("额度账户·种子期", () => {
  it("开户即入账当日额度：首日即可启动闭环，无历史要求（ADR-0016）", () => {
    const { admission } = makeAdmission();

    const account = admission.account();

    expect(account.period).toBe("seed");
    expect(account.balance).toBe(5); // ADR-0016：种子期每日入账 5
    expect(account.dailyAccrual).toBe(5);
    expect(account.completedReviews).toBe(0);
    expect(account.activeDays).toBe(0);
    expect(account.dueBacklog).toBe(0);
    expect(account.paused).toBe(false);
  });

  it("入账为查询时惰性结算：同日重复查询不重复入账，跨日按天累积", () => {
    const { clock, admission } = makeAdmission();

    expect(admission.account().balance).toBe(5);
    expect(admission.account().balance).toBe(5); // 同日重复查询

    clock.advance(12 * HOUR); // 仍在同一 UTC 日
    expect(admission.account().balance).toBe(5);

    clock.advance(12 * HOUR); // 次日
    expect(admission.account().balance).toBe(10);

    clock.advance(DAY); // 再隔一天：期间无任何调用，结算在查询时补齐
    expect(admission.account().balance).toBe(15);
  });

  it("余额上限 15：开户后闲置再久也不突破上限", () => {
    const { clock, admission } = makeAdmission();

    admission.account(); // 开户（安装日即入账当日额度）
    clock.advance(30 * DAY);

    expect(admission.account().balance).toBe(15); // ADR-0016：余额上限 15
  });
});

describe("支出：候选语块 → 正式语块", () => {
  it("支出 1 额度把候选语块转为正式语块", () => {
    const { admission, chunks } = makeAdmission();
    const candidate = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
    });
    expect(candidate.status).toBe("candidate");

    const enrolled = admission.enroll(candidate.id);

    expect(enrolled.status).toBe("enrolled");
    expect(admission.account().balance).toBe(4);
  });

  it("余额不足时拒绝支出：额度为整数，余额 < 1 不可新增", () => {
    const { admission, chunks } = makeAdmission();
    const candidates = Array.from({ length: 6 }, (_, i) =>
      chunks.registerChunk({ form: `phrase ${i} test`, chunkType: "collocation", language: "en" }),
    );

    for (const candidate of candidates.slice(0, 5)) {
      admission.enroll(candidate.id);
    }
    expect(admission.account().balance).toBe(0);
    expect(() => admission.enroll(candidates[5]!.id)).toThrow(/insufficient quota balance/);
  });

  it("已在调度中的语块不能重复支出；未知语块与其他语言的语块报错", () => {
    const { admission, chunks } = makeAdmission();
    const candidate = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
    });
    admission.enroll(candidate.id);

    expect(() => admission.enroll(candidate.id)).toThrow(/not a candidate/);
    expect(() => admission.enroll("no-such-chunk")).toThrow(/unknown chunk/);

    const japanese = chunks.registerChunk({
      form: "te form",
      chunkType: "collocation",
      language: "ja",
    });
    expect(() => admission.enroll(japanese.id)).toThrow(/unknown chunk/);
  });
});

describe("验收场景", () => {
  it("首周未学习的用户第 8 天仍能启动第一条闭环（种子期无历史要求）", () => {
    const { clock, admission, chunks, store } = makeAdmission();
    admission.account(); // 第 1 天安装开户，随后首周未学习

    clock.advance(7 * DAY); // 第 8 天

    const candidate = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
    });
    // 首周零学习历史，余额仍按种子期每日 5 累积（上限 15），可直接新增正式语块。
    expect(admission.account().balance).toBe(15);
    const enrolled = admission.enroll(candidate.id);
    expect(enrolled.status).toBe("enrolled");
    expect(admission.account().balance).toBe(14);

    // 预学完成 → 进入调度，首次到期 = 预学次日（ADR-0016），闭环启动。
    store.recordInitialLearning({ observationId: "obs-pre-1", chunkId: candidate.id });
    const projection = store.currentBeliefAt(T0 + 7 * DAY);
    const scheduled = projection.chunks.find((chunk) => chunk.chunkId === candidate.id);
    expect(scheduled?.dueAt).toBe(T0 + 8 * DAY);
  });
});

// 造一批已到期正式语块：昨日完成预学（initial-learning），今天起全部到期。
function seedDueChunks(
  db: Parameters<typeof insertChunk>[0],
  store: ReturnType<typeof openEventStore>,
  ids: string[],
  preLearnedAt: number,
): void {
  for (const id of ids) {
    insertChunk(db, id);
    store.recordInitialLearning({
      observationId: `obs-pre-${id}`,
      chunkId: id,
      occurredAt: preLearnedAt,
    });
  }
}

// 完成一次复习：无辅助正确产出（ADR-0013 矩阵 → FSRS Good），语块被重新排期。
function reviewOnce(store: ReturnType<typeof openEventStore>, id: string): void {
  store.recordEvidence({
    observationId: `obs-review-${id}`,
    chunkId: id,
    assistance: "none",
    outcome: "correct",
    confidence: 0.95,
    quote: "produced it unprompted",
  });
}

describe("积压闸口", () => {
  it("到期积压 >30 暂停支出（入账继续、只暂停不扣减），回落至 ≤20 恢复", () => {
    const { db, clock, admission, chunks, store } = makeAdmission();
    admission.account(); // 开户
    const ids = Array.from({ length: 31 }, (_, i) => `chunk-${i}`);
    seedDueChunks(db, store, ids, T0 - DAY);

    const pausedAccount = admission.account();
    expect(pausedAccount.dueBacklog).toBe(31);
    expect(pausedAccount.paused).toBe(true);

    const candidate = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
    });
    expect(() => admission.enroll(candidate.id)).toThrow(/enrollment paused/);

    // 入账继续：暂停期间余额照常累积到上限，暂停不扣减余额。
    clock.advance(3 * DAY);
    expect(admission.account().balance).toBe(15);
    expect(admission.account().paused).toBe(true);

    // 完成 6 条复习：积压 25，仍在 21–30 滞后区，维持暂停。
    for (const id of ids.slice(0, 6)) reviewOnce(store, id);
    expect(admission.account().dueBacklog).toBe(25);
    expect(admission.account().paused).toBe(true);
    expect(() => admission.enroll(candidate.id)).toThrow(/enrollment paused/);

    // 再完成 5 条：积压 20，回落至 ≤20 自动恢复。
    for (const id of ids.slice(6, 11)) reviewOnce(store, id);
    expect(admission.account().dueBacklog).toBe(20);
    expect(admission.account().paused).toBe(false);
    expect(admission.enroll(candidate.id).status).toBe("enrolled");
  });

  it("积压 21–30 之间且未曾超阈值时不暂停（滞后区的另一侧）", () => {
    const { db, admission, chunks, store } = makeAdmission();
    const ids = Array.from({ length: 25 }, (_, i) => `chunk-${i}`);
    seedDueChunks(db, store, ids, T0 - DAY);

    const account = admission.account();
    expect(account.dueBacklog).toBe(25);
    expect(account.paused).toBe(false);

    const candidate = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
    });
    expect(admission.enroll(candidate.id).status).toBe("enrolled");
  });
});

describe("种子期退出（依据有效学习历史而非日历）", () => {
  it("累计复习完成 ≥20 且活跃 ≥3 天才退出；同一天刷 20 条不退出", () => {
    const { db, clock, admission, store } = makeAdmission();
    admission.account(); // 开户
    // 24 条正式语块昨日完成预学，今天起分批复习。
    const ids = Array.from({ length: 24 }, (_, i) => `chunk-${i}`);
    seedDueChunks(db, store, ids, T0 - DAY);

    for (const id of ids.slice(0, 8)) reviewOnce(store, id);
    let account = admission.account();
    expect(account.completedReviews).toBe(8);
    expect(account.activeDays).toBe(1);
    expect(account.period).toBe("seed");

    clock.advance(DAY);
    for (const id of ids.slice(8, 16)) reviewOnce(store, id);
    account = admission.account();
    expect(account.completedReviews).toBe(16);
    expect(account.activeDays).toBe(2);
    expect(account.period).toBe("seed");

    clock.advance(DAY);
    for (const id of ids.slice(16, 24)) reviewOnce(store, id);
    account = admission.account();
    expect(account.completedReviews).toBe(24);
    expect(account.activeDays).toBe(3);
    // 达成退出条件的当天仍按种子期入账，次日起切自适应期。
    expect(account.period).toBe("seed");

    clock.advance(DAY);
    expect(admission.account().period).toBe("adaptive");
  });

  it("同一天完成 20 条复习但活跃不足 3 天：不退出种子期", () => {
    const { db, admission, store } = makeAdmission();
    const ids = Array.from({ length: 20 }, (_, i) => `chunk-${i}`);
    seedDueChunks(db, store, ids, T0 - DAY);

    for (const id of ids) reviewOnce(store, id);

    const account = admission.account();
    expect(account.completedReviews).toBe(20);
    expect(account.activeDays).toBe(1);
    expect(account.period).toBe("seed");
  });

  it("低置信度复习不计入有效学习历史，不能助推退出", () => {
    const { db, clock, admission, store } = makeAdmission();
    const ids = Array.from({ length: 24 }, (_, i) => `chunk-${i}`);
    seedDueChunks(db, store, ids, T0 - DAY);

    for (let batch = 0; batch < 3; batch++) {
      for (const id of ids.slice(batch * 8, batch * 8 + 8)) {
        store.recordEvidence({
          observationId: `obs-review-${id}`,
          chunkId: id,
          assistance: "none",
          outcome: "correct",
          confidence: 0.3, // 低于置信度门槛，仅审计不入状态
          quote: "mumbled something",
        });
      }
      clock.advance(DAY);
    }

    const account = admission.account();
    expect(account.completedReviews).toBe(0);
    expect(account.activeDays).toBe(0);
    expect(account.period).toBe("seed");
  });
});

// 三天各复习 8 条（共 24 条），第 3 天达成种子期退出条件。
function graduateToAdaptive(
  db: Parameters<typeof insertChunk>[0],
  clock: FakeClock,
  store: ReturnType<typeof openEventStore>,
): void {
  const ids = Array.from({ length: 24 }, (_, i) => `chunk-${i}`);
  seedDueChunks(db, store, ids, T0 - DAY);
  for (let batch = 0; batch < 3; batch++) {
    for (const id of ids.slice(batch * 8, batch * 8 + 8)) reviewOnce(store, id);
    clock.advance(DAY);
  }
}

describe("自适应期", () => {
  it("每日入账 = clamp(近 7 天日均完成 × 0.5, 1, 10)：小数额度经余额累积，支出按整数", () => {
    const { db, clock, admission, chunks, store } = makeAdmission();
    admission.account(); // 开户
    graduateToAdaptive(db, clock, store); // 退出种子期，时钟停在第 4 天

    // 近 7 天完成 24 条：24/7 × 0.5 = 12/7 ≈ 1.71。
    const account = admission.account();
    expect(account.period).toBe("adaptive");
    expect(account.dailyAccrual).toBeCloseTo(12 / 7, 10);

    // 余额先花到 0（开户以来按上限 15 累积）。
    const candidates = Array.from({ length: 20 }, (_, i) =>
      chunks.registerChunk({ form: `phrase ${i} test`, chunkType: "collocation", language: "en" }),
    );
    for (const candidate of candidates.slice(0, 15)) admission.enroll(candidate.id);
    expect(admission.account().balance).toBe(0);

    // 一天后入账 12/7：可支出 1 条，余额余下小数部分；再支出余额不足。
    clock.advance(DAY);
    expect(admission.account().balance).toBeCloseTo(12 / 7, 10);
    admission.enroll(candidates[15]!.id);
    expect(admission.account().balance).toBeCloseTo(12 / 7 - 1, 10);
    expect(() => admission.enroll(candidates[16]!.id)).toThrow(/insufficient quota balance/);

    // 再一天：小数累积到 12/7 - 1 + 12/7 ≈ 2.43，可支出 2 条。
    clock.advance(DAY);
    expect(admission.account().balance).toBeCloseTo(12 / 7 - 1 + 12 / 7, 10);
    admission.enroll(candidates[17]!.id);
    admission.enroll(candidates[18]!.id);
    expect(() => admission.enroll(candidates[19]!.id)).toThrow(/insufficient quota balance/);
  });

  it("完成量为零时保底每日入账 1：低频学习者新增额度明确、可持续", () => {
    const { db, clock, admission, chunks, store } = makeAdmission();
    admission.account(); // 开户
    graduateToAdaptive(db, clock, store);

    clock.advance(14 * DAY); // 近 7 天窗口内零完成

    const account = admission.account();
    expect(account.period).toBe("adaptive");
    expect(account.dailyAccrual).toBe(1); // ADR-0016：保底每日入账 1，不死锁

    // 余额上限内每天稳定 +1，低频用户靠余额持续可新增。
    const candidates = Array.from({ length: 20 }, (_, i) =>
      chunks.registerChunk({ form: `phrase ${i} test`, chunkType: "collocation", language: "en" }),
    );
    for (const candidate of candidates.slice(0, 15)) admission.enroll(candidate.id);
    expect(admission.account().balance).toBe(0);

    clock.advance(DAY);
    expect(admission.account().balance).toBe(1);
    clock.advance(DAY);
    expect(admission.account().balance).toBe(2);
    admission.enroll(candidates[15]!.id);
    admission.enroll(candidates[16]!.id);
    expect(admission.account().balance).toBe(0);
  });

  it("每日入账上限 10：近 7 天日均完成 ≥20 时按 10 入账", () => {
    const { db, clock, admission, store } = makeAdmission();
    admission.account(); // 开户
    // 7 天每天完成 20 条复习（共 140 条）。
    const ids = Array.from({ length: 140 }, (_, i) => `chunk-${i}`);
    seedDueChunks(db, store, ids, T0 - DAY);
    for (let day = 0; day < 7; day++) {
      for (const id of ids.slice(day * 20, day * 20 + 20)) reviewOnce(store, id);
      clock.advance(DAY);
    }

    const account = admission.account();
    expect(account.period).toBe("adaptive");
    expect(account.dailyAccrual).toBe(10); // 140/7 × 0.5 = 10，封顶 10
  });
});

describe("语言隔离", () => {
  it("他语的复习历史与到期积压不影响本语言额度账户", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const clock = new FakeClock(T0);
    const store = openEventStore({ db, clock });
    const english = openAdmission({ db, clock, language: "en" });
    const japanese = openAdmission({ db, clock, language: "ja" });
    english.account();
    japanese.account();

    // en：24 条复习横跨 3 天（足以退出种子期）+ 31 条到期积压（足以暂停）。
    graduateToAdaptive(db, clock, store);
    const backlogIds = Array.from({ length: 31 }, (_, i) => `backlog-${i}`);
    seedDueChunks(db, store, backlogIds, T0 - DAY);

    const enAccount = english.account();
    expect(enAccount.period).toBe("adaptive");
    expect(enAccount.paused).toBe(true);

    // ja：无本语言历史，仍是种子期、不暂停；en 的事件不进 ja 的有效历史。
    const jaAccount = japanese.account();
    expect(jaAccount.period).toBe("seed");
    expect(jaAccount.paused).toBe(false);
    expect(jaAccount.completedReviews).toBe(0);
    expect(jaAccount.dueBacklog).toBe(0);
    expect(jaAccount.dailyAccrual).toBe(5);
  });
});
