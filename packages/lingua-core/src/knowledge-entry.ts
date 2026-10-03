import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 知识条目（GLOSSARY）：约束 agent 讲解的最小单位（ADR-0005）——
// 一切语言讲解从条目出发（RAG 式 grounding，防 LLM 编造伪语言学规则），
// 三层呈现：第一层 例句+一句直觉规律（默认）；第二层 规律细化与对比；
// 第三层 术语与理论。深挖由用户显式触发。
//
// 条目是随仓库分发的策展内容（CC BY 4.0，见 data/README.md），运行时只读，
// 故文件承载、启动时加载校验，不占 schema 迁移；讲解的投递记录
// （entry_id + 证据等级 + 层）落库 explanation_refs（见 explanation-log.ts）。

export const KNOWLEDGE_CATEGORIES = ["中英思维差异", "高频语法", "语用语域"] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const EVIDENCE_LEVELS = ["学界共识", "教学性概括", "有争议"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export type ExplanationLayer = 1 | 2 | 3;

export type KnowledgeEntry = {
  id: string;
  language: string;
  category: KnowledgeCategory;
  title: string;
  layers: {
    // 第一层：例句 + 一句直觉规律。
    intuition: { example: string; rule: string };
    // 第二层：规律细化与对比。
    expansion: string;
    // 第三层：术语与理论。
    terminology: string;
  };
  evidenceLevel: EvidenceLevel;
  // 一手来源引注（引用而非转载）：WALS/EGP/CEFR CV 特征锚或学术文献。
  sources: string[];
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function fail(id: unknown, reason: string): never {
  const where = typeof id === "string" && id.length > 0 ? `条目 ${id}` : "知识条目";
  throw new Error(`${where}${reason}`);
}

function requireText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseEntry(raw: unknown): KnowledgeEntry {
  if (typeof raw !== "object" || raw === null) fail(undefined, "：不是对象");
  const input = raw as Record<string, unknown>;
  const id = input.id;
  if (!requireText(id) || !SLUG.test(id)) fail(id, `：id 需为小写 slug，实际为 ${String(id)}`);
  if (!requireText(input.language)) fail(id, "：language 缺失");
  if (!KNOWLEDGE_CATEGORIES.includes(input.category as KnowledgeCategory)) {
    fail(id, `：类别非法（${String(input.category)}），须为 ${KNOWLEDGE_CATEGORIES.join("/")}`);
  }
  if (!requireText(input.title)) fail(id, "：title 缺失");
  const layers = input.layers as Record<string, unknown> | undefined;
  const intuition = layers?.intuition as Record<string, unknown> | undefined;
  if (
    typeof layers !== "object" ||
    layers === null ||
    typeof intuition !== "object" ||
    intuition === null ||
    !requireText(intuition.example) ||
    !requireText(intuition.rule) ||
    !requireText(layers.expansion) ||
    !requireText(layers.terminology)
  ) {
    fail(id, "：三层内容（intuition.example/rule、expansion、terminology）缺一不可");
  }
  if (!EVIDENCE_LEVELS.includes(input.evidenceLevel as EvidenceLevel)) {
    fail(
      id,
      `：证据等级非法（${String(input.evidenceLevel)}），须为 ${EVIDENCE_LEVELS.join("/")}`,
    );
  }
  if (
    !Array.isArray(input.sources) ||
    input.sources.length === 0 ||
    !input.sources.every(requireText)
  ) {
    fail(id, "：来源列表至少一条非空引注");
  }
  return {
    id,
    language: input.language,
    category: input.category as KnowledgeCategory,
    title: input.title,
    layers: {
      intuition: { example: intuition.example, rule: intuition.rule },
      expansion: layers.expansion,
      terminology: layers.terminology,
    },
    evidenceLevel: input.evidenceLevel as EvidenceLevel,
    sources: input.sources,
  };
}

export function parseKnowledgeEntries(raw: unknown): KnowledgeEntry[] {
  if (!Array.isArray(raw)) throw new Error("知识条目数据须为数组");
  const entries = raw.map(parseEntry);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) fail(entry.id, `：id 重复（${entry.id}）`);
    seen.add(entry.id);
  }
  return entries;
}

export type KnowledgeCatalogItem = {
  id: string;
  title: string;
  category: KnowledgeCategory;
};

export type KnowledgeStore = {
  get(id: string): KnowledgeEntry | null;
  listByCategory(category: KnowledgeCategory, options?: { language?: string }): KnowledgeEntry[];
  // 紧凑目录（id + 标题 + 类别），供对话 prompt 注入做检索锚。
  catalog(options?: { language?: string }): KnowledgeCatalogItem[];
};

export function openKnowledgeStore(options: { entries: KnowledgeEntry[] }): KnowledgeStore {
  const entries = [...options.entries];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const byCategoryOrder = new Map(KNOWLEDGE_CATEGORIES.map((category, index) => [category, index]));
  return {
    get(id) {
      return byId.get(id) ?? null;
    },
    listByCategory(category, listOptions = {}) {
      return entries.filter(
        (entry) =>
          entry.category === category &&
          (listOptions.language === undefined || entry.language === listOptions.language),
      );
    },
    catalog(catalogOptions = {}) {
      return entries
        .filter(
          (entry) =>
            catalogOptions.language === undefined || entry.language === catalogOptions.language,
        )
        .map(({ id, title, category }) => ({ id, title, category }))
        .sort((a, b) =>
          byCategoryOrder.get(a.category)! - byCategoryOrder.get(b.category)! !== 0
            ? byCategoryOrder.get(a.category)! - byCategoryOrder.get(b.category)!
            : a.id < b.id
              ? -1
              : 1,
        );
    },
  };
}

// 三层呈现（ADR-0005）：默认只给第一层；第二、三层仅在用户显式深挖时渲染。
// 输出携带条目 ID 与证据等级，保证交付的讲解可追溯回条目。
export function renderExplanation(
  entry: KnowledgeEntry,
  options: { layer?: ExplanationLayer } = {},
): string {
  const layer = options.layer ?? 1;
  const lines = [
    `【${entry.id}】${entry.title}（证据等级：${entry.evidenceLevel}）`,
    `例：${entry.layers.intuition.example}`,
    `直觉：${entry.layers.intuition.rule}`,
  ];
  if (layer >= 2) lines.push(`展开：${entry.layers.expansion}`);
  if (layer >= 3) lines.push(`术语：${entry.layers.terminology}`);
  return lines.join("\n");
}

// 随包分发的种子库（CC BY 4.0 内容，校验程序见 data/README.md）。
const DEFAULT_DATA_PATH = fileURLToPath(
  new URL("../data/knowledge-entries.json", import.meta.url),
);

// 启动时加载并全量校验：数据文件损坏应立刻失败，而不是在讲解时才暴雷。
export function loadKnowledgeEntries(path: string = DEFAULT_DATA_PATH): KnowledgeEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  // 数据文件顶层可带说明字段（$schema-note 等），条目在 entries 键下；
  // 也接受裸数组（测试夹具用）。
  const list =
    Array.isArray(raw) || raw === null || typeof raw !== "object"
      ? raw
      : (raw as { entries?: unknown }).entries;
  return parseKnowledgeEntries(list);
}
