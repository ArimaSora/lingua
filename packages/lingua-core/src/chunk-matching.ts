import { tokenize } from "./lemmatizer";
import type { Token } from "./lemmatizer";

// 语块命中判定：确定性规则（词形还原 + token 区间匹配），是 Judge 接口背后的
// 非 LLM 半边（ADR-0010）。匹配结果只有 matched / not-found / unsupported——
// 失败判定不在这里产生：缺席至多是「观察机会」（no-evidence，ADR-0013），
// 用法正误由判分器负责。

export type ChunkDescriptor = {
  id: string;
  canonicalForm: string;
  chunkType: string;
  variants?: string[];
  slotPattern?: string | null;
};

export type ChunkOccurrence = {
  chunkId: string;
  startToken: number;
  endToken: number;
  startChar: number;
  endChar: number;
  surface: string;
  matchedForm: string;
};

// v1 仅搭配与惯用语可被可靠匹配（MVP 修订 5）；其余类型不判失败，只记观察机会。
export type ChunkScanStatus = "matched" | "not-found" | "unsupported";

export type ChunkScan = {
  chunkId: string;
  status: ChunkScanStatus;
};

export type MatchSummary = {
  occurrences: ChunkOccurrence[];
  scans: ChunkScan[];
};

// v1 仅搭配与惯用语可被可靠匹配（MVP 修订 5）；其余类型不判失败，只记观察机会。
export const SUPPORTED_CHUNK_TYPES: ReadonlySet<string> = new Set(["collocation", "idiom"]);

// 槽位以 `___` 标记（如 `look ___ up`），匹配 0–MAX_SLOT_TOKENS 个任意 token。
// 上限防止病态长距离吸附；句读边界另有 breakBefore 拦截。
const MAX_SLOT_TOKENS = 8;
const SLOT_MARK = /^_{3,}$/;

type PatternElement = { kind: "lemma"; lemma: string } | { kind: "slot" };

type CompiledPattern = {
  elements: PatternElement[];
  matchedForm: string;
  // 同语块同区间命中多个形态时的取舍：规范形式 > 变体 > 槽位模式。
  formRank: number;
};

function compileFixed(form: string, formRank: number): CompiledPattern | null {
  const elements: PatternElement[] = tokenize(form).map((token) => ({
    kind: "lemma",
    lemma: token.lemma,
  }));
  if (elements.length === 0) return null;
  return { elements, matchedForm: form, formRank };
}

function compileSlotPattern(pattern: string): CompiledPattern | null {
  const elements: PatternElement[] = [];
  for (const part of pattern.trim().split(/\s+/)) {
    if (SLOT_MARK.test(part)) {
      elements.push({ kind: "slot" });
    } else {
      for (const token of tokenize(part)) {
        elements.push({ kind: "lemma", lemma: token.lemma });
      }
    }
  }
  if (elements.length === 0) return null;
  return { elements, matchedForm: pattern, formRank: 2 };
}

function compilePatterns(chunk: ChunkDescriptor): CompiledPattern[] {
  const patterns: CompiledPattern[] = [];
  const canonical = compileFixed(chunk.canonicalForm, 0);
  if (canonical) patterns.push(canonical);
  for (const variant of chunk.variants ?? []) {
    const compiled = compileFixed(variant, 1);
    if (compiled) patterns.push(compiled);
  }
  if (chunk.slotPattern) {
    const compiled = compileSlotPattern(chunk.slotPattern);
    if (compiled) patterns.push(compiled);
  }
  return patterns;
}

// 在 start 处匹配：槽位取最短填充（论元延伸到首个收尾词即闭合，
// 如 look it up 不会被吸成 look it up … up），返回首个完整匹配的区间终点。
// 「长匹配优先」体现在跨语块的重叠去重，不在单个槽位的伸展。
// 任何落在 (start, end) 内的句读边界都使匹配无效。
function matchAt(tokens: Token[], start: number, elements: PatternElement[]): number | null {
  let maxEnd = tokens.length;
  for (let i = start + 1; i < tokens.length; i += 1) {
    if (tokens[i]!.breakBefore) {
      maxEnd = i;
      break;
    }
  }

  const search = (ti: number, ei: number): number | null => {
    if (ei === elements.length) return ti;
    const element = elements[ei]!;
    if (element.kind === "lemma") {
      if (ti < maxEnd && tokens[ti]!.lemma === element.lemma) return search(ti + 1, ei + 1);
      return null;
    }
    const upper = Math.min(MAX_SLOT_TOKENS, maxEnd - ti);
    for (let len = 0; len <= upper; len += 1) {
      const result = search(ti + len, ei + 1);
      if (result !== null) return result;
    }
    return null;
  };

  return search(start, 0);
}

type Candidate = {
  occurrence: ChunkOccurrence;
  formRank: number;
};

export function matchChunks(text: string, chunks: ChunkDescriptor[]): MatchSummary {
  const tokens = tokenize(text);
  const candidates: Candidate[] = [];
  const scans: ChunkScan[] = [];

  for (const chunk of chunks) {
    if (!SUPPORTED_CHUNK_TYPES.has(chunk.chunkType)) {
      scans.push({ chunkId: chunk.id, status: "unsupported" });
      continue;
    }
    const before = candidates.length;
    for (const pattern of compilePatterns(chunk)) {
      for (let start = 0; start < tokens.length; start += 1) {
        const end = matchAt(tokens, start, pattern.elements);
        if (end === null) continue;
        candidates.push({
          formRank: pattern.formRank,
          occurrence: {
            chunkId: chunk.id,
            startToken: start,
            endToken: end,
            startChar: tokens[start]!.start,
            endChar: tokens[end - 1]!.end,
            surface: text.slice(tokens[start]!.start, tokens[end - 1]!.end),
            matchedForm: pattern.matchedForm,
          },
        });
      }
    }
    scans.push({
      chunkId: chunk.id,
      status: candidates.length > before ? "matched" : "not-found",
    });
  }

  // 同语块同区间的多形态命中只留一个（规范形式 > 变体 > 槽位模式）。
  const bestBySpan = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.occurrence.chunkId}:${candidate.occurrence.startToken}:${candidate.occurrence.endToken}`;
    const existing = bestBySpan.get(key);
    if (!existing || candidate.formRank < existing.formRank) {
      bestBySpan.set(key, candidate);
    }
  }

  // 重叠去重（ADR-0015）：长匹配优先，其余按确定性次序，逐条接受不与已接受者
  // 共享 token 的命中。scan 状态以去重后的出现为准——被长匹配吃掉的区间不算命中。
  const ordered = [...bestBySpan.values()].sort((a, b) => {
    const lengthDiff =
      b.occurrence.endToken - b.occurrence.startToken - (a.occurrence.endToken - a.occurrence.startToken);
    if (lengthDiff !== 0) return lengthDiff;
    if (a.occurrence.startToken !== b.occurrence.startToken) {
      return a.occurrence.startToken - b.occurrence.startToken;
    }
    if (a.occurrence.chunkId !== b.occurrence.chunkId) {
      return a.occurrence.chunkId < b.occurrence.chunkId ? -1 : 1;
    }
    if (a.formRank !== b.formRank) return a.formRank - b.formRank;
    return a.occurrence.matchedForm < b.occurrence.matchedForm ? -1 : 1;
  });

  const accepted: ChunkOccurrence[] = [];
  for (const candidate of ordered) {
    const overlaps = accepted.some(
      (kept) =>
        candidate.occurrence.startToken < kept.endToken &&
        kept.startToken < candidate.occurrence.endToken,
    );
    if (!overlaps) accepted.push(candidate.occurrence);
  }

  const matchedIds = new Set(accepted.map((occurrence) => occurrence.chunkId));
  const finalScans: ChunkScan[] = scans.map(
    (scan): ChunkScan =>
      scan.status === "unsupported"
        ? scan
        : { chunkId: scan.chunkId, status: matchedIds.has(scan.chunkId) ? "matched" : "not-found" },
  );

  accepted.sort((a, b) => a.startToken - b.startToken);
  return { occurrences: accepted, scans: finalScans };
}
