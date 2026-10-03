import { SUPPORTED_CHUNK_TYPES } from "./chunk-matching";
import type { ChunkType } from "./chunk-store";

// Bootstrap 课包内容格式（issue #6，GLOSSARY「Bootstrap 课包」）：
// 系统为零基础语言准备的策展内容源，按序推送，复用「推送 → 预学 → 埋伏使用」闭环。
// 课 = 内容源：高频生存语块 / 基础句构 / A1 分级短文。每课带一句
// 「为什么你会感兴趣」钩子与预学清单——每条语块只给第一层解释
// （例句 + 一句直觉规律，ADR-0005）。本模块只做格式定义与校验，不碰存储。

export const LESSON_KINDS = ["survival-chunks", "sentence-patterns", "graded-text"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

export type PackChunk = {
  form: string;
  chunkType: ChunkType;
  cefr: Cefr;
  variants: string[];
  slotPattern: string | null;
  // 第一层解释（ADR-0005）：例句 + 一句直觉规律，默认只展示这层。
  example: string;
  intuition: string;
};

export type PackLesson = {
  id: string;
  title: string;
  kind: LessonKind;
  // 一句「为什么你会感兴趣」钩子（docs/specs/mvp.md 故事 4）。
  hook: string;
  // 课正文：生存语块课的迷你对话、句构课的讲解、分级短文原文。
  body: string;
  chunks: PackChunk[];
};

export type BootstrapPack = {
  id: string;
  language: string;
  title: string;
  // 数组顺序即推送顺序。
  lessons: PackLesson[];
};

function fail(reason: string): never {
  throw new Error(`Bootstrap 课包格式错误：${reason}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} 应为对象`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${where} 缺 ${key}（非空字符串）`);
  }
  return value as string;
}

function optionalStringList(record: Record<string, unknown>, key: string, where: string): string[] {
  const value = record[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${where} 的 ${key} 应为字符串数组`);
  }
  return [...new Set(value as string[])];
}

function parseChunk(raw: unknown, where: string): PackChunk {
  const record = asRecord(raw, where);
  const form = requiredString(record, "form", `${where}（语块形式）`);
  const chunkType = requiredString(record, "chunkType", where);
  if (!SUPPORTED_CHUNK_TYPES.has(chunkType)) {
    fail(`${where} chunkType 仅支持 collocation | idiom（v1），收到：${chunkType}`);
  }
  const cefr = requiredString(record, "cefr", where);
  if (!CEFR_LEVELS.includes(cefr as Cefr)) {
    fail(`${where} CEFR 应为 ${CEFR_LEVELS.join("/")}，收到：${cefr}`);
  }
  const slotPattern = record.slotPattern;
  if (slotPattern !== undefined && slotPattern !== null && typeof slotPattern !== "string") {
    fail(`${where} slotPattern 应为字符串`);
  }
  return {
    form,
    chunkType: chunkType as ChunkType,
    cefr: cefr as Cefr,
    variants: optionalStringList(record, "variants", where),
    slotPattern: typeof slotPattern === "string" ? slotPattern : null,
    example: requiredString(record, "example", `${where}（第一层解释缺例句）`),
    intuition: requiredString(record, "intuition", `${where}（第一层解释缺直觉规律）`),
  };
}

function parseLesson(raw: unknown, index: number): PackLesson {
  const where = `第 ${index + 1} 课`;
  const record = asRecord(raw, where);
  const id = requiredString(record, "id", where);
  const kind = requiredString(record, "kind", `${where}（${id}）`);
  if (!LESSON_KINDS.includes(kind as LessonKind)) {
    fail(`${where}（${id}）kind 应为 ${LESSON_KINDS.join(" | ")}，收到：${kind}`);
  }
  const chunksRaw = record.chunks;
  if (!Array.isArray(chunksRaw) || chunksRaw.length === 0) {
    fail(`${where}（${id}）预学清单 chunks 至少一条语块`);
  }
  return {
    id,
    title: requiredString(record, "title", `${where}（${id}）`),
    kind: kind as LessonKind,
    hook: requiredString(record, "hook", `${where}（${id}，缺兴趣钩子）`),
    body: requiredString(record, "body", `${where}（${id}，缺正文）`),
    chunks: chunksRaw.map((chunk, chunkIndex) =>
      parseChunk(chunk, `${where}（${id}）第 ${chunkIndex + 1} 条语块`),
    ),
  };
}

export function parseBootstrapPack(raw: unknown): BootstrapPack {
  const record = asRecord(raw, "课包");
  const id = requiredString(record, "id", "课包");
  const lessonsRaw = record.lessons;
  if (!Array.isArray(lessonsRaw) || lessonsRaw.length === 0) {
    fail(`课包（${id}）lessons 至少一课`);
  }
  const lessons = lessonsRaw.map(parseLesson);
  const seen = new Set<string>();
  for (const lesson of lessons) {
    if (seen.has(lesson.id)) fail(`课 id 重复：${lesson.id}`);
    seen.add(lesson.id);
  }
  return {
    id,
    language: requiredString(record, "language", `课包（${id}）`),
    title: requiredString(record, "title", `课包（${id}）`),
    lessons,
  };
}
