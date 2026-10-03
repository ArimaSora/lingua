import { matchChunks } from "./chunk-matching";
import type { ChunkDescriptor } from "./chunk-matching";
import type { Database } from "./database";
import type { Outcome } from "./event-store";

// Judge 接口（issue #7；ADR-0017 真接缝：Jev / Qwen-flash 级 LLM / 测试 fake）。
// 判分器是传感器（ADR-0002）：只输出**证据**（产出结果 + 置信度；辅助情况由
// AfterTurn 用确定性暴露规则判定并随证据给出），事件结论与状态更新映射由
// 票 01 管线派生（ADR-0013/0014），判分器永不直接给出事件类型。
//
// 模型分工（ADR-0010）：语块命中判定 = 确定性规则（票 02 词形还原 + 字符串
// 匹配）；用法正误 = LLM 判分（Jev 主适配器 / Qwen-flash 降级，配置级切换）。
// 语块缺席由规则独立判定为「未产出」（未获得证据，永不记失败），不消耗 LLM。

export type JudgeTarget = {
  chunkId: string;
  // 近 N 轮内角色或系统是否示范过该语块形式（ADR-0013 辅助情况的上游证据）。
  exposedRecently: boolean;
};

export type JudgeRequest = {
  // 用户消息原文。
  userText: string;
  targets: JudgeTarget[];
  // 话题原文（判分语境）。
  topicText?: string | null;
};

export type JudgeVerdict = {
  chunkId: string;
  outcome: Outcome;
  confidence: number;
  // 用户文本中的命中表面；未产出时为空串。
  quote: string;
};

export interface Judge {
  readonly name: string;
  readonly version: string;
  judge(request: JudgeRequest): Promise<JudgeVerdict[]>;
}

// LLM 半边（ADR-0010）：只判「用法正误」，是否出现已由规则确定。
export type UsageJudgeInput = {
  userText: string;
  chunk: {
    chunkId: string;
    canonicalForm: string;
    surface: string;
    matchedForm: string;
  };
  exposedRecently: boolean;
  topicText?: string | null;
};

export type UsageVerdict = {
  outcome: "correct" | "wrong";
  confidence: number;
};

export interface UsageJudge {
  readonly name: string;
  readonly version: string;
  judgeUsage(input: UsageJudgeInput): Promise<UsageVerdict>;
}

// 判分 prompt（ADR-0013 Consequences）：携带「近期是否暴露该语块」标记。
// 只问用法正误——出现与否规则已定；要求结构化 JSON 输出。
export function buildJudgePrompt(input: UsageJudgeInput): string {
  const lines = [
    "你是语言学习判分器。用户在英语对话中使用了下面的目标语块——是否出现已由确定性规则判定，无需复核；你只判断这次使用在语境中是否正确、地道。",
    "",
    `用户消息原文：${input.userText}`,
    `目标语块：${input.chunk.canonicalForm}`,
    `命中表面：${input.chunk.surface}`,
  ];
  if (input.topicText) {
    lines.push(`话题语境：${input.topicText}`);
  }
  lines.push(
    `近期是否暴露：${input.exposedRecently ? "是" : "否"}（近几轮对话中角色是否示范过该语块形式）`,
    "",
    '只判用法正误（语法、搭配、语域是否得当），不判是否出现。只输出 JSON：{"outcome": "correct" | "wrong", "confidence": 0 到 1 的校准置信度}；拿不准时降低 confidence，不要猜。',
  );
  return lines.join("\n");
}

export type JudgeOptions = {
  db: Database;
  usageJudge: UsageJudge;
  userId?: string;
};

type DescriptorRow = {
  id: string;
  canonical_form: string;
  chunk_type: string;
  variants: string;
  slot_pattern: string | null;
};

export function createJudge(options: JudgeOptions): Judge {
  const { db, usageJudge } = options;
  const userId = options.userId ?? "local";
  const getDescriptor = db.prepare(
    "SELECT id, canonical_form, chunk_type, variants, slot_pattern FROM chunks WHERE id = ? AND user_id = ?",
  );

  return {
    name: `rule+${usageJudge.name}`,
    version: usageJudge.version,
    async judge(request) {
      const descriptors = new Map<string, ChunkDescriptor>();
      for (const target of request.targets) {
        const row = getDescriptor.get(target.chunkId, userId) as DescriptorRow | undefined;
        if (!row) throw new Error(`unknown chunk: ${target.chunkId}`);
        descriptors.set(target.chunkId, {
          id: row.id,
          canonicalForm: row.canonical_form,
          chunkType: row.chunk_type,
          variants: JSON.parse(row.variants) as string[],
          slotPattern: row.slot_pattern,
        });
      }

      const { occurrences } = matchChunks(request.userText, [...descriptors.values()]);
      const byChunk = new Map<string, (typeof occurrences)[number]>();
      for (const occurrence of occurrences) {
        if (!byChunk.has(occurrence.chunkId)) byChunk.set(occurrence.chunkId, occurrence);
      }

      const verdicts: JudgeVerdict[] = [];
      for (const target of request.targets) {
        const occurrence = byChunk.get(target.chunkId);
        if (!occurrence) {
          // 缺席 = 未产出（未获得证据，ADR-0013）：规则独立判定，不消耗 LLM。
          verdicts.push({
            chunkId: target.chunkId,
            outcome: "not-produced",
            confidence: 1,
            quote: "",
          });
          continue;
        }
        const descriptor = descriptors.get(target.chunkId)!;
        const verdict = await usageJudge.judgeUsage({
          userText: request.userText,
          chunk: {
            chunkId: target.chunkId,
            canonicalForm: descriptor.canonicalForm,
            surface: occurrence.surface,
            matchedForm: occurrence.matchedForm,
          },
          exposedRecently: target.exposedRecently,
          topicText: request.topicText ?? null,
        });
        verdicts.push({
          chunkId: target.chunkId,
          outcome: verdict.outcome,
          confidence: verdict.confidence,
          quote: occurrence.surface,
        });
      }
      return verdicts;
    },
  };
}
