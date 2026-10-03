import type { Clock } from "./clock";
import type { Database } from "./database";
import {
  DEFAULT_SCAFFOLDING_TIER,
  parseScaffoldingTier,
  type ScaffoldingTier,
} from "./scaffolding";

// 角色卡（GLOSSARY）：人格基底模板（口吻、性格、场景、开场白）+ Lingua 扩展字段
// （兴趣层、母语支架档位、语域范围、语言对）。卡片存为策展事实后进入 digest
// 的「角色须知」段（见 loadCharacterCard）。

export const REGISTER_LEVELS = ["casual", "neutral", "formal"] as const;
export type Register = (typeof REGISTER_LEVELS)[number];

export type RegisterRange = { from: Register; to: Register };
export type LanguagePair = { native: string; target: string };

export type CharacterCard = {
  name: string;
  persona: string;
  interests: string[];
  scaffoldingTier: ScaffoldingTier;
  registerRange: RegisterRange;
  languagePair: LanguagePair;
};

const DEFAULT_REGISTER_RANGE: RegisterRange = { from: "casual", to: "neutral" };
const DEFAULT_LANGUAGE_PAIR: LanguagePair = { native: "zh", target: "en" };

function fail(reason: string): never {
  throw new Error(`非法角色卡：${reason}`);
}

function parseRegister(value: unknown): Register {
  if (typeof value === "string" && (REGISTER_LEVELS as readonly string[]).includes(value)) {
    return value as Register;
  }
  return fail(`未知语域 ${String(value)}（可选：${REGISTER_LEVELS.join(" / ")}）`);
}

function parseRegisterRange(value: unknown): RegisterRange {
  if (value === undefined) return { ...DEFAULT_REGISTER_RANGE };
  if (typeof value !== "object" || value === null) return fail("registerRange 需为对象");
  const range = value as Record<string, unknown>;
  const from = parseRegister(range.from);
  const to = parseRegister(range.to);
  if (REGISTER_LEVELS.indexOf(from) > REGISTER_LEVELS.indexOf(to)) {
    return fail(`语域范围颠倒：${from} → ${to}`);
  }
  return { from, to };
}

function parseLanguagePair(value: unknown): LanguagePair {
  if (value === undefined) return { ...DEFAULT_LANGUAGE_PAIR };
  if (typeof value !== "object" || value === null) return fail("languagePair 需为对象");
  const pair = value as Record<string, unknown>;
  if (typeof pair.native !== "string" || pair.native.length === 0) return fail("缺 native 语言");
  if (typeof pair.target !== "string" || pair.target.length === 0) return fail("缺 target 语言");
  return { native: pair.native, target: pair.target };
}

function parseInterests(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return fail("interests 需为字符串数组");
  }
  return [...value];
}

export function parseCharacterCard(input: unknown): CharacterCard {
  if (typeof input !== "object" || input === null) return fail("需为对象");
  const raw = input as Record<string, unknown>;
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) return fail("缺名字");
  if (typeof raw.persona !== "string" || raw.persona.trim().length === 0) {
    return fail("缺人格基底（persona）");
  }
  return {
    name: raw.name.trim(),
    persona: raw.persona,
    interests: parseInterests(raw.interests),
    scaffoldingTier:
      raw.scaffoldingTier === undefined
        ? DEFAULT_SCAFFOLDING_TIER
        : parseScaffoldingTier(raw.scaffoldingTier),
    registerRange: parseRegisterRange(raw.registerRange),
    languagePair: parseLanguagePair(raw.languagePair),
  };
}

// ---- 持久化：character_cards 表 + 派生策展事实（relationship_facts） ----

export type LoadCharacterCardOptions = {
  db: Database;
  clock: Clock;
  card: unknown;
};

type CardRow = {
  name: string;
  persona: string;
  interests: string;
  scaffolding_tier: string;
  register_range: string;
  language_pair: string;
};

function rowToCard(row: CardRow): CharacterCard {
  return parseCharacterCard({
    name: row.name,
    persona: row.persona,
    interests: JSON.parse(row.interests),
    scaffoldingTier: row.scaffolding_tier,
    registerRange: JSON.parse(row.register_range),
    languagePair: JSON.parse(row.language_pair),
  });
}

export function getCharacterCard(options: {
  db: Database;
  language: string;
}): CharacterCard | null {
  const row = options.db
    .prepare(
      `SELECT name, persona, interests, scaffolding_tier, register_range, language_pair
       FROM character_cards WHERE language = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(options.language) as unknown as CardRow | undefined;
  return row ? rowToCard(row) : null;
}

// 加载角色卡：校验 → 持久化 → 派生策展事实（角色卡存为策展事实，GLOSSARY）。
// 幂等：该语言已有卡时直接返回现有卡，不重复写事实。
export function loadCharacterCard(options: LoadCharacterCardOptions): CharacterCard {
  const { db, clock } = options;
  const card = parseCharacterCard(options.card);
  const existing = getCharacterCard({ db, language: card.languagePair.target });
  if (existing) return existing;

  db.prepare(
    `INSERT INTO character_cards
       (id, language, name, persona, interests, scaffolding_tier, register_range, language_pair, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clock.newId(),
    card.languagePair.target,
    card.name,
    card.persona,
    JSON.stringify(card.interests),
    card.scaffoldingTier,
    JSON.stringify(card.registerRange),
    JSON.stringify(card.languagePair),
    clock.now(),
  );

  for (const fact of characterCardFacts(card)) {
    addRelationshipFact({ db, clock, language: card.languagePair.target, fact, source: "character-card" });
  }
  return card;
}

// 角色卡 → digest 输入（issue #5）：哪些卡片字段进入 digest「角色须知」段
// 的唯一规则处。人格基底走系统提示（壳装配），不进 digest。
export function characterCardFacts(card: CharacterCard): string[] {
  if (card.interests.length === 0) return [];
  return [`用户与角色 ${card.name} 的共同兴趣：${card.interests.join("、")}`];
}

export function addRelationshipFact(options: {
  db: Database;
  clock: Clock;
  language: string;
  fact: string;
  source?: string;
}): string {
  const { db, clock, language, fact } = options;
  const card = db
    .prepare("SELECT id FROM character_cards WHERE language = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(language) as unknown as { id: string } | undefined;
  if (!card) throw new Error(`语言 ${language} 尚无角色卡，无法挂策展事实`);
  const id = clock.newId();
  db.prepare(
    `INSERT INTO relationship_facts (id, language, card_id, fact, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, language, card.id, fact, options.source ?? null, clock.now());
  return id;
}
