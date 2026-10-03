import { rowToChunk } from "./chunk-store";
import type { Chunk, ChunkRow } from "./chunk-store";
import type { Clock } from "./clock";
import type { Database } from "./database";
import { admittedEvents, projectState } from "./projection";

// 准入控制（ADR-0016）：候选语块（提取即入池，零成本）与正式语块（进 FSRS 调度，
// 产生复习义务）分离；本模块负责候选 → 正式的受控转换。
//
// 额度账户制：每日入账、余额累积、新增正式语块按整数支出、余额上限 15。
// 入账为查询时惰性结算——不依赖调度器 tick：账户行只存结算进度
// （last_settled_day）与余额，每次查询先把未结算天数按当日速率结清。
// 速率不设状态：种子期 / 自适应期由有效学习历史（ADR-0014 当前认知口径）
// 实时推导。日界按 UTC 日切分（确定性、与注入时钟对齐）。

export const SEED_DAILY_ACCRUAL = 5;
export const SEED_EXIT_COMPLETED_REVIEWS = 20;
export const SEED_EXIT_ACTIVE_DAYS = 3;
export const ADAPTIVE_WINDOW_DAYS = 7;
export const ADAPTIVE_ACCRUAL_FACTOR = 0.5;
export const ADAPTIVE_MIN_DAILY_ACCRUAL = 1;
export const ADAPTIVE_MAX_DAILY_ACCRUAL = 10;
export const BALANCE_CAP = 15;
// 积压闸口带滞后：>30 暂停支出、回落至 ≤20 恢复，其间维持原状。
export const BACKLOG_PAUSE_THRESHOLD = 30;
export const BACKLOG_RESUME_THRESHOLD = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

export type AdmissionPeriod = "seed" | "adaptive";

export type QuotaAccount = {
  // 额度余额：小数额度经余额累积处理，支出按整数扣减。
  balance: number;
  // 当日入账速率（种子期 5；自适应期 clamp(近 7 天日均完成 × 0.5, 1, 10)）。
  dailyAccrual: number;
  period: AdmissionPeriod;
  // 到期积压暂停支出中（入账不受影响）。
  paused: boolean;
  // 当前到期积压：正式语块中已到期的数量。
  dueBacklog: number;
  // 有效学习历史口径：累计复习完成与活跃天数（种子期退出条件）。
  completedReviews: number;
  activeDays: number;
};

export type Admission = {
  // 查询额度账户：先惰性结算入账与积压闸口，再返回视图。
  account(): QuotaAccount;
  // 支出 1 额度，把候选语块转为正式语块（进 FSRS 调度）。
  enroll(chunkId: string): Chunk;
};

export type AdmissionOptions = {
  db: Database;
  clock: Clock;
  userId?: string;
  language: string;
};

type AccountRow = {
  user_id: string;
  language: string;
  balance: number;
  last_settled_day: number;
  paused: number;
  updated_at: number;
};

// 复习完成 = 有效管线下携带 FSRS 评分的真实回忆事件（ADR-0013 矩阵）；
// initial-learning 是预学记录，不冒充复习完成。
function completionsByDay(db: Database, horizon: number, language: string): Map<number, number> {
  const byDay = new Map<number, number>();
  for (const event of admittedEvents(db, horizon, language)) {
    if (event.fsrsRating === null) continue;
    const day = dayIndex(event.occurredAt);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return byDay;
}

// 退出日 = 有效历史中首次同时满足两个条件的那一天；达成当天仍按种子期入账，
// 次日起切自适应期。
function findExitDay(byDay: Map<number, number>): number | null {
  let cumulative = 0;
  let active = 0;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    cumulative += byDay.get(day) ?? 0;
    active += 1;
    if (cumulative >= SEED_EXIT_COMPLETED_REVIEWS && active >= SEED_EXIT_ACTIVE_DAYS) {
      return day;
    }
  }
  return null;
}

function dailyAccrualFor(day: number, exitDay: number | null, byDay: Map<number, number>): number {
  if (exitDay === null || day <= exitDay) return SEED_DAILY_ACCRUAL;
  let windowTotal = 0;
  for (let d = day - ADAPTIVE_WINDOW_DAYS; d < day; d++) {
    windowTotal += byDay.get(d) ?? 0;
  }
  const rate = (windowTotal / ADAPTIVE_WINDOW_DAYS) * ADAPTIVE_ACCRUAL_FACTOR;
  return Math.min(ADAPTIVE_MAX_DAILY_ACCRUAL, Math.max(ADAPTIVE_MIN_DAILY_ACCRUAL, rate));
}

export function openAdmission(options: AdmissionOptions): Admission {
  const { db, clock, language } = options;
  const userId = options.userId ?? "local";

  const getAccount = db.prepare(
    "SELECT * FROM admission_accounts WHERE user_id = ? AND language = ?",
  );
  const upsertAccount = db.prepare(
    `INSERT INTO admission_accounts (user_id, language, balance, last_settled_day, paused, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, language) DO UPDATE SET
       balance = excluded.balance,
       last_settled_day = excluded.last_settled_day,
       paused = excluded.paused,
       updated_at = excluded.updated_at`,
  );
  const spendBalance = db.prepare(
    `UPDATE admission_accounts SET balance = ?, updated_at = ?
     WHERE user_id = ? AND language = ?`,
  );
  const getChunkRow = db.prepare(
    "SELECT * FROM chunks WHERE id = ? AND user_id = ? AND language = ?",
  );
  const markEnrolled = db.prepare("UPDATE chunks SET status = 'enrolled' WHERE id = ?");

  function dueBacklog(now: number): number {
    return projectState(db, "current-belief", now, language).chunks.filter(
      (chunk) => chunk.dueAt !== null && chunk.dueAt <= now,
    ).length;
  }

  // 惰性结算：结清未结算天数的入账（余额上限封顶），再按当前积压推闸口，
  // 持久化后返回账户视图。account() 与 enroll() 共用这一条路径。
  function settle(): QuotaAccount {
    const now = clock.now();
    const today = dayIndex(now);
    const byDay = completionsByDay(db, now, language);
    const exitDay = findExitDay(byDay);

    const existing = getAccount.get(userId, language) as AccountRow | undefined;
    let balance: number;
    if (!existing) {
      // 开户即入账当日额度：首周未学习的用户在任何一天开始都能启动第一条闭环。
      balance = dailyAccrualFor(today, exitDay, byDay);
    } else {
      balance = existing.balance;
      for (let day = existing.last_settled_day + 1; day <= today; day++) {
        balance += dailyAccrualFor(day, exitDay, byDay);
      }
    }
    balance = Math.min(BALANCE_CAP, balance);

    // 闸口滞后：>30 暂停、≤20 恢复，21–30 之间维持原状；只暂停不扣减。
    const backlog = dueBacklog(now);
    let paused = existing?.paused === 1;
    if (backlog > BACKLOG_PAUSE_THRESHOLD) paused = true;
    else if (backlog <= BACKLOG_RESUME_THRESHOLD) paused = false;

    upsertAccount.run(userId, language, balance, today, paused ? 1 : 0, now);

    let completedReviews = 0;
    for (const count of byDay.values()) completedReviews += count;

    return {
      balance,
      dailyAccrual: dailyAccrualFor(today, exitDay, byDay),
      period: exitDay !== null && today > exitDay ? "adaptive" : "seed",
      paused,
      dueBacklog: backlog,
      completedReviews,
      activeDays: byDay.size,
    };
  }

  function account(): QuotaAccount {
    return settle();
  }

  function enroll(chunkId: string): Chunk {
    const chunkRow = getChunkRow.get(chunkId, userId, language) as ChunkRow | undefined;
    if (!chunkRow) {
      throw new Error(`unknown chunk: ${chunkId}`);
    }
    if (chunkRow.status !== "candidate") {
      throw new Error(`chunk is not a candidate: ${chunkId}`);
    }

    const current = settle();
    if (current.paused) {
      throw new Error(
        `enrollment paused: due backlog ${current.dueBacklog} (resumes at <= ${BACKLOG_RESUME_THRESHOLD})`,
      );
    }
    if (current.balance < 1) {
      throw new Error(`insufficient quota balance: ${current.balance}`);
    }

    markEnrolled.run(chunkId);
    spendBalance.run(current.balance - 1, clock.now(), userId, language);
    return rowToChunk({ ...chunkRow, status: "enrolled" });
  }

  return { account, enroll };
}
