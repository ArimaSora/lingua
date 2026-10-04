import type { Clock } from "./clock";
import type { Database } from "./database";
import { projectState } from "./projection";
import type { ScaffoldingTier } from "./scaffolding";
import { scaffoldingPolicyDescription, SCAFFOLDING_TIER_LABELS } from "./scaffolding";

// 摘要（Digest）：注入对话 prompt 的唯一状态形式（ADR-0002），
// 选料 + token 预算 + 渲染收拢在本模块，对外只有 renderDigest（ADR-0017）。
// 三段：埋伏目标（到期语块）/ 近期弱点（PFA 最低技能点）/ 角色须知（策展事实）。
// issue #13：角色须知段联动当前母语支架档位。

// ADR-0002：≤300 token。
export const DIGEST_TOKEN_BUDGET = 300;

export type DigestOptions = {
  db: Database;
  clock: Clock;
  language: string;
  // 传入档位后 digest 会包含当前支架策略，供模型即时跟随。
  tier?: ScaffoldingTier;
};

export type Digest = {
  text: string;
  // estimateTokens(text)，调用方按此校验预算。
  tokens: number;
  // 是否有条目因预算被丢弃或截短。
  truncated: boolean;
};

// 确定性 token 估计：CJK/全宽字符每字 1 token，其余约 4 字符 1 token。
// 是保守估计而非真实分词器——预算按此口径执行，保证确定性截断。
const WIDE_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function estimateTokens(text: string): number {
  let wide = 0;
  let rest = 0;
  for (const char of text) {
    if (WIDE_CHAR.test(char)) wide += 1;
    else rest += 1;
  }
  return wide + Math.ceil(rest / 4);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// 每话题埋 2–4 个到期语块（docs/specs/mvp.md）。
const MAX_AMBUSH_TARGETS = 4;
const MAX_WEAKNESSES = 3;
const MAX_FACTS = 5;

export function renderDigest(options: DigestOptions): Digest {
  const { db, clock, language } = options;
  const budget = DIGEST_TOKEN_BUDGET;
  const now = clock.now();

  // 语块规范形式表，兼作本语言的成员判定（投影本身不按语言隔离）。
  const canonicalForms = new Map(
    (
      db
        .prepare("SELECT id, canonical_form FROM chunks WHERE language = ?")
        .all(language) as unknown as { id: string; canonical_form: string }[]
    ).map((row) => [row.id, row.canonical_form]),
  );

  const projection = projectState(db, "current-belief", now);

  // 埋伏目标：当前认知下到期的语块，最逾期者优先。
  const ambush = projection.chunks
    .filter(
      (chunk) =>
        chunk.dueAt !== null && chunk.dueAt <= now && canonicalForms.has(chunk.chunkId),
    )
    .sort((a, b) =>
      a.dueAt! - b.dueAt! !== 0 ? a.dueAt! - b.dueAt! : a.chunkId < b.chunkId ? -1 : 1,
    )
    .slice(0, MAX_AMBUSH_TARGETS)
    .map((chunk) => `- ${canonicalForms.get(chunk.chunkId)}（到期 ${isoDate(chunk.dueAt!)}）`);

  // 近期弱点：PFA 掌握度最低的技能点。
  const weaknesses = projection.skills
    .filter((skill) => canonicalForms.has(skill.skillId))
    .sort((a, b) =>
      a.mastery !== b.mastery ? a.mastery - b.mastery : a.skillId < b.skillId ? -1 : 1,
    )
    .slice(0, MAX_WEAKNESSES)
    .map(
      (skill) => `- ${canonicalForms.get(skill.skillId)}（掌握 ${Math.round(skill.mastery * 100)}%）`,
    );

  // 角色须知：最近的策展事实。v1 无对话话题上下文可选「相关」，
  // 确定性取最近若干条（mvp.md 的「相关 curated facts」待话题指针就位后细化）。
  const facts = (
    db
      .prepare(
        "SELECT fact FROM relationship_facts WHERE language = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(language, MAX_FACTS) as unknown as { fact: string }[]
  ).map((row) => `- ${row.fact}`);

  if (options.tier !== undefined) {
    facts.unshift(
      `- 当前母语支架：${options.tier}（${SCAFFOLDING_TIER_LABELS[options.tier]}；${scaffoldingPolicyDescription(options.tier)}）`,
    );
  }

  // 预算截断（确定性）：段落优先级 埋伏目标 > 近期弱点 > 角色须知；
  // 超预算时从最低优先级段的段尾整行丢弃。
  const sections = [
    { header: "埋伏目标：", items: ambush },
    { header: "近期弱点：", items: weaknesses },
    { header: "角色须知：", items: facts },
  ];
  const render = () =>
    sections
      .filter((section) => section.items.length > 0)
      .map((section) => [section.header, ...section.items].join("\n"))
      .join("\n");
  const totalItems = () => sections.reduce((count, section) => count + section.items.length, 0);

  let truncated = false;
  while (estimateTokens(render()) > budget && totalItems() > 1) {
    truncated = true;
    const lowest = [...sections].reverse().find((section) => section.items.length > 0);
    lowest!.items.pop();
  }

  // 仅剩一条仍超预算的病理情形：截短该条本身（保留段落与条目前缀）。
  let text = render();
  while (estimateTokens(text) > budget) {
    truncated = true;
    const lines = text.split("\n");
    const last = lines[lines.length - 1]!;
    if (!last.startsWith("- ") || last.length <= 4) {
      lines.pop();
    } else {
      lines[lines.length - 1] = `${last.slice(0, Math.max(4, Math.floor(last.length / 2)))}…`;
    }
    text = lines.join("\n");
  }

  return { text, tokens: estimateTokens(text), truncated };
}
