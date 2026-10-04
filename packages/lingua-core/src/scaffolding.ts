// 母语支架档位（ADR-0004/0015）：用户可控，不随 CEFR 自动渐退。
// 四档行为定义见 docs/specs/mvp.md「双语与语域」：
// A1–A2 救场无限制 + 角色消息附可展开中文翻译；B1 仅明确求助时救场；
// B2 澄清请求代替救场；C1+ 全目标语。档位名按行为命名，不复用 CEFR 标签
// （ADR-0015 三旋钮分离：支架档位不跟随 CEFR）。

export const SCAFFOLDING_TIERS = [
  "full-support",
  "on-request",
  "clarify-only",
  "target-only",
] as const;

export type ScaffoldingTier = (typeof SCAFFOLDING_TIERS)[number];

// 零基础起点，不做入学定级（docs/specs/mvp.md 用户故事 13）。
export const DEFAULT_SCAFFOLDING_TIER: ScaffoldingTier = "full-support";

export const SCAFFOLDING_TIER_LABELS: Record<ScaffoldingTier, string> = {
  "full-support": "A1–A2 全支架",
  "on-request": "B1 求助才救场",
  "clarify-only": "B2 澄清代替救场",
  "target-only": "C1+ 全目标语",
};

export function parseScaffoldingTier(value: unknown): ScaffoldingTier {
  if (typeof value === "string" && (SCAFFOLDING_TIERS as readonly string[]).includes(value)) {
    return value as ScaffoldingTier;
  }
  throw new Error(`未知母语支架档位：${String(value)}（可选：${SCAFFOLDING_TIERS.join(" / ")}）`);
}

export type L1Rescue = "unrestricted" | "explicit-request" | "clarify-only" | "none";

// 壳层按此策略装配：是否要求角色消息附中文翻译（渲染为可展开折叠）、
// 系统提示中如何约束角色的母语救场行为。
export type ScaffoldingPolicy = {
  attachL1Translation: boolean;
  l1Rescue: L1Rescue;
};

export function scaffoldingPolicy(tier: ScaffoldingTier): ScaffoldingPolicy {
  switch (tier) {
    case "full-support":
      return { attachL1Translation: true, l1Rescue: "unrestricted" };
    case "on-request":
      return { attachL1Translation: false, l1Rescue: "explicit-request" };
    case "clarify-only":
      return { attachL1Translation: false, l1Rescue: "clarify-only" };
    case "target-only":
      return { attachL1Translation: false, l1Rescue: "none" };
  }
}

const L1_RESCUE_LABELS: Record<L1Rescue, string> = {
  unrestricted: "救场无限制",
  "explicit-request": "仅明确求助时救场",
  "clarify-only": "澄清请求代替救场",
  none: "全目标语",
};

export function scaffoldingPolicyDescription(tier: ScaffoldingTier): string {
  const policy = scaffoldingPolicy(tier);
  const translation = policy.attachL1Translation ? "附翻译" : "无翻译";
  return `${translation}，${L1_RESCUE_LABELS[policy.l1Rescue]}`;
}

// ---- 语域（Register）：标注与开放节奏 ----

export const REGISTER_LEVELS = ["casual", "neutral", "formal"] as const;
export type Register = (typeof REGISTER_LEVELS)[number];

export type RegisterRange = { from: Register; to: Register };

export const REGISTER_LABELS: Record<Register, string> = {
  casual: "这句很口语",
  neutral: "中性表达",
  formal: "较正式",
};

// 语域开放节奏跟随支架档位（ADR-0015）：支架越少，可向用户开放的语域越宽。
// full-support/on-request 只到 neutral；clarify-only/target-only 解锁 formal。
const TIER_REGISTER_CEILING: Record<ScaffoldingTier, Register> = {
  "full-support": "neutral",
  "on-request": "neutral",
  "clarify-only": "formal",
  "target-only": "formal",
};

export function registerCeiling(tier: ScaffoldingTier): Register {
  return TIER_REGISTER_CEILING[tier];
}

// 在角色卡自身语域范围基础上，按当前支架档位裁剪。
export function effectiveRegisterRange(
  tier: ScaffoldingTier,
  personaRange: RegisterRange,
): RegisterRange {
  const ceilingIndex = REGISTER_LEVELS.indexOf(registerCeiling(tier));
  const fromIndex = REGISTER_LEVELS.indexOf(personaRange.from);
  const toIndex = REGISTER_LEVELS.indexOf(personaRange.to);
  const effectiveTo = Math.min(toIndex, ceilingIndex);
  const effectiveFrom = Math.min(fromIndex, effectiveTo);
  return {
    from: REGISTER_LEVELS[effectiveFrom]!,
    to: REGISTER_LEVELS[effectiveTo]!,
  };
}

export type RegisterAnnotation = {
  start: number;
  end: number;
  register: Register;
  label: string;
};

const REGISTER_MARKER_RE = /\[\[register:(casual|neutral|formal)\]\]/g;

// 角色消息语域标注的标记约定：在需要标注的表达前放 `[[register:<level>]]`，
// 表达结束后放 `[[register:neutral]]` 切回中性。壳层负责拆分并在前端渲染提示。
export function splitRegisterAnnotations(raw: string): {
  text: string;
  annotations: RegisterAnnotation[];
} {
  let text = "";
  let lastIndex = 0;
  let activeRegister: Register | null = null;
  const annotations: RegisterAnnotation[] = [];

  function flushSegment(segment: string) {
    if (activeRegister && segment.length > 0) {
      const start = text.length;
      text += segment;
      annotations.push({
        start,
        end: text.length,
        register: activeRegister,
        label: REGISTER_LABELS[activeRegister],
      });
    } else {
      text += segment;
    }
  }

  for (const match of raw.matchAll(REGISTER_MARKER_RE)) {
    flushSegment(raw.slice(lastIndex, match.index));
    activeRegister = match[1] === "neutral" ? null : (match[1] as Register);
    lastIndex = match.index + match[0].length;
  }
  flushSegment(raw.slice(lastIndex));

  return { text, annotations };
}

// ---- 支架档位控制：用户手动调整 + 系统建议需确认（ADR-0015） ----

import type { Clock } from "./clock";
import type { Database } from "./database";
import { admittedEvents } from "./projection";

const DEFAULT_USER_ID = "local";
const SUGGESTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SUGGESTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const TEMPORARY_DURATION_MS = 24 * 60 * 60 * 1000;

export type ScaffoldingTierSource = "card" | "manual" | "suggestion";

export type ScaffoldingSuggestion = {
  tier: ScaffoldingTier;
  reason: string;
};

type ProfileRow = {
  scaffolding_tier: string | null;
  temporary_tier: string | null;
  temporary_until: number | null;
  pending_suggested_tier: string | null;
  pending_reason: string | null;
  pending_at: number | null;
  last_suggested_tier: string | null;
  last_suggested_at: number | null;
  last_suggestion_response: "accepted" | "rejected" | null;
};

function getProfile(
  db: Database,
  userId: string,
  language: string,
): ProfileRow | undefined {
  return db
    .prepare(
      `SELECT scaffolding_tier, temporary_tier, temporary_until,
              pending_suggested_tier, pending_reason, pending_at,
              last_suggested_tier, last_suggested_at, last_suggestion_response
       FROM learner_profiles WHERE user_id = ? AND language = ?`,
    )
    .get(userId, language) as unknown as ProfileRow | undefined;
}

function upsertProfile(
  db: Database,
  clock: Clock,
  userId: string,
  language: string,
  setClause: Record<string, string | number | null>,
): void {
  const existing = db
    .prepare("SELECT 1 FROM learner_profiles WHERE user_id = ? AND language = ?")
    .get(userId, language);
  const now = clock.now();
  if (existing) {
    const columns = Object.keys(setClause);
    if (columns.length === 0) return;
    const assignments = columns.map((c) => `${c} = ?`).join(", ");
    const values = columns.map((c) => setClause[c]!);
    db.prepare(`UPDATE learner_profiles SET ${assignments}, updated_at = ? WHERE user_id = ? AND language = ?`).run(
      ...values,
      now,
      userId,
      language,
    );
  } else {
    db.prepare(
      `INSERT INTO learner_profiles
         (user_id, language, scaffolding_tier, temporary_tier, temporary_until,
          pending_suggested_tier, pending_reason, pending_at,
          last_suggested_tier, last_suggested_at, last_suggestion_response, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      language,
      setClause.scaffolding_tier ?? DEFAULT_SCAFFOLDING_TIER,
      setClause.temporary_tier ?? null,
      setClause.temporary_until ?? null,
      setClause.pending_suggested_tier ?? null,
      setClause.pending_reason ?? null,
      setClause.pending_at ?? null,
      setClause.last_suggested_tier ?? null,
      setClause.last_suggested_at ?? null,
      setClause.last_suggestion_response ?? null,
      now,
    );
  }
}

// 启动时确保学习者档案存在：无记录时以角色卡档位初始化，不覆盖用户手动设置。
export function ensureLearnerProfile(options: {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
  cardTier?: ScaffoldingTier;
}): void {
  const { db, clock, language } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  if (getProfile(db, userId, language)) return;
  upsertProfile(db, clock, userId, language, {
    scaffolding_tier: options.cardTier ?? DEFAULT_SCAFFOLDING_TIER,
  });
}

// 读取当前生效档位：临时档位优先；无记录时回退到角色卡默认值。
export function getScaffoldingTier(options: {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
}): { tier: ScaffoldingTier; source: ScaffoldingTierSource; temporary: boolean } {
  const { db, clock, language } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  const row = getProfile(db, userId, language);
  const now = clock.now();
  if (row?.temporary_tier && row.temporary_until !== null && row.temporary_until > now) {
    return { tier: parseScaffoldingTier(row.temporary_tier), source: "manual", temporary: true };
  }
  if (row?.scaffolding_tier) {
    return { tier: parseScaffoldingTier(row.scaffolding_tier), source: "manual", temporary: false };
  }
  return { tier: DEFAULT_SCAFFOLDING_TIER, source: "card", temporary: false };
}

// 手动调档（含临时下调）：即刻生效、系统记档不评判。
export function setScaffoldingTier(options: {
  db: Database;
  clock: Clock;
  language: string;
  tier: ScaffoldingTier;
  userId?: string;
  temporary?: boolean;
}): void {
  const { db, clock, language, tier } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  if (options.temporary) {
    upsertProfile(db, clock, userId, language, {
      temporary_tier: tier,
      temporary_until: clock.now() + TEMPORARY_DURATION_MS,
      pending_suggested_tier: null,
      pending_reason: null,
      pending_at: null,
    });
  } else {
    upsertProfile(db, clock, userId, language, {
      scaffolding_tier: tier,
      temporary_tier: null,
      temporary_until: null,
      pending_suggested_tier: null,
      pending_reason: null,
      pending_at: null,
    });
  }
}

export function clearTemporaryScaffoldingTier(options: {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
}): void {
  const { db, clock, language } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  upsertProfile(db, clock, userId, language, {
    temporary_tier: null,
    temporary_until: null,
  });
}

function tierIndex(tier: ScaffoldingTier): number {
  return SCAFFOLDING_TIERS.indexOf(tier);
}

function suggestionFromEvents(
  currentTier: ScaffoldingTier,
  now: number,
  events: { occurredAt: number; eventType: string }[],
): ScaffoldingSuggestion | null {
  const windowStart = now - SUGGESTION_WINDOW_MS;
  const recent = events.filter((e) => e.occurredAt >= windowStart && e.occurredAt <= now);
  const successes = recent.filter((e) => e.eventType === "independent-production").length;
  const failures = recent.filter((e) => e.eventType === "independent-attempt-failed").length;

  const currentIndex = tierIndex(currentTier);
  if (currentIndex < SCAFFOLDING_TIERS.length - 1 && successes >= 3 && failures === 0) {
    const tier = SCAFFOLDING_TIERS[currentIndex + 1]!;
    return {
      tier,
      reason: `最近 7 天你有 ${successes} 次独立产出且无失败，试试减少中文支架。`,
    };
  }
  if (currentIndex > 0 && failures >= 2 && successes === 0) {
    const tier = SCAFFOLDING_TIERS[currentIndex - 1]!;
    return {
      tier,
      reason: `最近 7 天你有 ${failures} 次独立尝试失败，先加一档中文支架。`,
    };
  }
  return null;
}

// 依据事件流提出档位建议；返回建议时会写入待确认状态，未确认前不影响行为。
export function proposeScaffoldingTier(options: {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
}): ScaffoldingSuggestion | null {
  const { db, clock, language } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  const now = clock.now();
  const row = getProfile(db, userId, language);
  if (row?.pending_suggested_tier) return null;
  if (
    row?.last_suggested_at &&
    row.last_suggestion_response === "rejected" &&
    now - row.last_suggested_at < SUGGESTION_COOLDOWN_MS
  ) {
    return null;
  }

  const current = getScaffoldingTier({ db, clock, language, userId }).tier;
  const events = admittedEvents(db, now, language);
  const suggestion = suggestionFromEvents(current, now, events);
  if (!suggestion) return null;

  upsertProfile(db, clock, userId, language, {
    pending_suggested_tier: suggestion.tier,
    pending_reason: suggestion.reason,
    pending_at: now,
  });
  return suggestion;
}

export function getPendingSuggestion(options: {
  db: Database;
  language: string;
  userId?: string;
}): ScaffoldingSuggestion | null {
  const { db, language } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  const row = getProfile(db, userId, language);
  if (!row?.pending_suggested_tier || !row.pending_reason) return null;
  return {
    tier: parseScaffoldingTier(row.pending_suggested_tier),
    reason: row.pending_reason,
  };
}

// 确认系统建议：应用档位并清空待确认状态。
export function acceptScaffoldingSuggestion(options: {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
}): void {
  const { db, clock, language } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  const row = getProfile(db, userId, language);
  if (!row?.pending_suggested_tier) {
    throw new Error("没有待确认的支架档位建议");
  }
  upsertProfile(db, clock, userId, language, {
    scaffolding_tier: row.pending_suggested_tier,
    temporary_tier: null,
    temporary_until: null,
    pending_suggested_tier: null,
    pending_reason: null,
    pending_at: null,
    last_suggested_tier: row.pending_suggested_tier,
    last_suggested_at: clock.now(),
    last_suggestion_response: "accepted",
  });
}

// 拒绝系统建议：仅清空待确认状态并记录拒绝历史，不改变行为。
export function rejectScaffoldingSuggestion(options: {
  db: Database;
  clock: Clock;
  language: string;
  userId?: string;
}): void {
  const { db, clock, language } = options;
  const userId = options.userId ?? DEFAULT_USER_ID;
  const row = getProfile(db, userId, language);
  if (!row?.pending_suggested_tier) {
    throw new Error("没有待确认的支架档位建议");
  }
  upsertProfile(db, clock, userId, language, {
    pending_suggested_tier: null,
    pending_reason: null,
    pending_at: null,
    last_suggested_tier: row.pending_suggested_tier,
    last_suggested_at: clock.now(),
    last_suggestion_response: "rejected",
  });
}

export function formatScaffoldingSuggestion(suggestion: ScaffoldingSuggestion): string {
  return (
    `系统建议：将母语支架调至 ${suggestion.tier}（${suggestion.reason}）\n` +
    `回复「确认调档」应用，回复「取消」忽略。`
  );
}
