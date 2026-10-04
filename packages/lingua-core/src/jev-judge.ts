import type { UsageJudge, UsageJudgeInput, UsageVerdict } from "./judge";

// Jev 判分适配器（issue #17；ADR-0010：Jev 为主判分适配器，LLM 为降级路径）。
//
// 调研结论（2026-10，公开资料交叉验证：typesafe.ai 官方文档、@typesafe-ai/sdk、
// flaviocopes.com/dev.to 实操文、OpenRouter 镜像实验仓库）：
// - Jev = TypeSafe System One「决策模型」，**不是文本模型**：不支持 chat/completions，
//   只收 state（文本证据）+ questions（类型化问题），并行返回每个问题的类型化答案；
// - 官方直连 endpoint：POST {base}/systemone（base 默认 https://api.typesafe.ai/v1），
//   Authorization: Bearer <TYPESAFE_API_KEY>；OpenRouter 镜像走
//   POST https://openrouter.ai/api/alpha/decisions（同一协议，model=typesafe/jev-1.13），
//   故 transport 的 endpoint 为完整 URL，可按网关替换；
// - 问题类型三选一：noul（是/否概率 0..1）、choice（N 选一）、score（2–10 级量表）；
//   响应 = { model, answers: {<qid>: {type, noul}}, usage }；
// - 非 2xx：401 密钥错 / 422 请求校验失败 / 429 限流 / 529 过载（429/529 宜退避重试，
//   本适配器不重试，直接 throw 交给降级层，保持传感器语义简单）。
//
// 适配器只负责协议组装与解析；真实 HTTP 由可注入 JevTransport 完成（壳层实现，
// 测试注入 fake），非 2xx / 超时 / 响应缺字段一律 throw，由
// createFallbackUsageJudge 降级到 LLM 判分（createLlmUsageJudge，壳层）。

export const DEFAULT_JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-latest";

// 判分只问一个问题：用法是否正确。noul 概率同时承载 outcome 与置信度
// （p >= 0.5 → correct/confidence=p；p < 0.5 → wrong/confidence=1-p，
// 对齐「置信度是所下结论的校准概率」的语义）。
export const JEV_USAGE_QUESTION_ID = "usage_correct";

export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
};

export type JevSystemOneRequest = {
  model: string;
  state: Record<string, string>;
  questions: Record<string, JevNoulQuestion>;
};

// transport 接收已组装好的 System One 请求，返回响应 JSON（unknown——解析是
// 适配器的职责，transport 只保证拿到 HTTP 层成功的 body）。
export type JevTransport = (request: JevSystemOneRequest) => Promise<unknown>;

// 把 UsageJudgeInput 映射成 System One 请求。state 只放文本（Jev 只读文本），
// 布尔证据降级为 yes/no 字符串；instructions 与 buildJudgePrompt（LLM 降级路径）
// 问同一件事——只判用法正误，是否出现已由确定性规则判定。
export function buildJevUsageRequest(input: UsageJudgeInput, model: string): JevSystemOneRequest {
  const state: Record<string, string> = {
    user_text: input.userText,
    chunk_canonical_form: input.chunk.canonicalForm,
    chunk_surface: input.chunk.surface,
    matched_form: input.chunk.matchedForm,
    exposed_recently: input.exposedRecently ? "yes" : "no",
  };
  if (input.topicText) state.topic_text = input.topicText;
  return {
    model,
    state,
    questions: {
      [JEV_USAGE_QUESTION_ID]: {
        type: "noul",
        instructions:
          "用户消息 user_text 中命中 chunk_surface 的目标语块 chunk_canonical_form，" +
          "这次使用在语境中是否正确、地道（语法、搭配、语域）？是否出现已由规则判定，无需复核；" +
          "近期是否暴露见 exposed_recently（角色是否示范过该形式）。只判用法正误。",
      },
    },
  };
}

// 解析 System One 响应为 UsageVerdict。畸形响应（非对象、缺 answers、缺问题、
// noul 非有限数）一律 throw——noul 同时是结论与置信度，缺失即无法判定方向，
// 与 LLM 路径「缺 outcome 即抛」对齐，交给降级层；数值越界 clamp 到 [0,1]。
export function parseJevUsageVerdict(payload: unknown): UsageVerdict {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Jev 响应畸形：不是 JSON 对象");
  }
  const answers = (payload as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) {
    throw new Error("Jev 响应畸形：缺 answers 字段");
  }
  const answer = (answers as Record<string, unknown>)[JEV_USAGE_QUESTION_ID];
  if (typeof answer !== "object" || answer === null) {
    throw new Error(`Jev 响应畸形：缺 ${JEV_USAGE_QUESTION_ID} 答案`);
  }
  const { type, noul } = answer as { type?: unknown; noul?: unknown };
  if (type !== undefined && type !== "noul") {
    throw new Error(`Jev 响应畸形：${JEV_USAGE_QUESTION_ID} 类型为 ${String(type)}，预期 noul`);
  }
  if (typeof noul !== "number" || !Number.isFinite(noul)) {
    throw new Error(`Jev 响应畸形：${JEV_USAGE_QUESTION_ID}.noul 缺失或非数值`);
  }
  const p = Math.min(1, Math.max(0, noul));
  return p >= 0.5
    ? { outcome: "correct", confidence: p }
    : { outcome: "wrong", confidence: 1 - p };
}

export type JevUsageJudgeOptions = {
  transport: JevTransport;
  model?: string;
};

export function createJevUsageJudge(options: JevUsageJudgeOptions): UsageJudge {
  const model = options.model ?? DEFAULT_JEV_MODEL;
  return {
    name: "jev-usage",
    version: "1",
    async judgeUsage(input): Promise<UsageVerdict> {
      const payload = await options.transport(buildJevUsageRequest(input, model));
      return parseJevUsageVerdict(payload);
    },
  };
}

export type FallbackUsageJudgeOptions = {
  primary: UsageJudge;
  fallback: UsageJudge;
  // 降级观测点（壳层接日志）；测试用来断言降级确实发生。
  onFallback?: (error: unknown, input: UsageJudgeInput) => void;
};

// 降级组合（ADR-0010：Jev 主 / LLM 降级）：主判分抛错（非 2xx、超时、响应
// 不可解析）时落到 fallback，其结果原样透传；主判分正常时 fallback 不被调用。
// 传感器故障 ≠ 学习者没产出——降级只为保住判分通道，上层结算失败仍由
// ambush-loop 兜底（本轮不记证据）。
export function createFallbackUsageJudge(options: FallbackUsageJudgeOptions): UsageJudge {
  const { primary, fallback } = options;
  return {
    name: `${primary.name}→${fallback.name}`,
    version: primary.version,
    async judgeUsage(input): Promise<UsageVerdict> {
      try {
        return await primary.judgeUsage(input);
      } catch (error) {
        options.onFallback?.(error, input);
        return fallback.judgeUsage(input);
      }
    },
  };
}

// ---- 判分配置项解析（[models.judge] / [models.judge_fallback]） ----

// OpenAI 兼容的模型配置（main / judge_fallback / 非 jev 的 judge 共用此形态）。
export type JudgeModelConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
};

export type JudgeSelection =
  | { kind: "llm"; judge: JudgeModelConfig }
  | {
      kind: "jev";
      apiKey: string;
      // 完整 endpoint URL（默认官方直连；OpenRouter 镜像换
      // https://openrouter.ai/api/alpha/decisions）。
      endpoint: string;
      model: string;
      // Jev 不可用时降级的 LLM 判分（judge_fallback 段完整配置时用之，否则主模型兼任）。
      fallback: JudgeModelConfig;
    };

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// 解析 OpenAI 兼容模型段（缺哪个字段就报哪个字段）。
function parseOpenAiSection(section: Record<string, unknown>, sectionName: string): JudgeModelConfig {
  const provider = readString(section, "provider");
  const model = readString(section, "model");
  const apiKey = readString(section, "api_key");
  const baseUrl = readString(section, "base_url");
  for (const [key, value] of [
    ["provider", provider],
    ["model", model],
    ["api_key", apiKey],
    ["base_url", baseUrl],
  ] as const) {
    if (!value) throw new Error(`[models.${sectionName}] 缺 ${key}（或非空字符串）`);
  }
  return { provider: provider!, model: model!, apiKey: apiKey!, baseUrl: baseUrl! };
}

// judgeRaw / fallbackRaw 为 TOML 解析出的原始表（unknown——校验是本分内的规则）。
// 缺 [models.judge] 时默认 LLM 判分由主模型兼任：Jev 需单独申请 early-access
// key，静默默认 jev 会让既有 config.toml 启动即失败；显式配置才启用 Jev。
export function parseJudgeSelection(
  judgeRaw: unknown,
  fallbackRaw: unknown,
  main: JudgeModelConfig,
): JudgeSelection {
  if (judgeRaw === undefined || judgeRaw === null) {
    return { kind: "llm", judge: main };
  }
  if (typeof judgeRaw !== "object" || Array.isArray(judgeRaw)) {
    throw new Error("[models.judge] 必须是 TOML 表");
  }
  const section = judgeRaw as Record<string, unknown>;
  const provider = readString(section, "provider");
  if (!provider) throw new Error("[models.judge] 缺 provider");

  if (provider !== "jev") {
    // 任意 OpenAI 兼容判分（ADR-0010 的 Qwen-flash 级降级即此种配置）。
    return { kind: "llm", judge: parseOpenAiSection(section, "judge") };
  }

  const apiKey = readString(section, "api_key");
  if (!apiKey) {
    throw new Error("[models.judge] provider = \"jev\" 但 api_key 为空——填入 TypeSafe key 后重启");
  }
  // judge_fallback 段完整配置时用之，否则主模型兼任降级判分。
  let fallback = main;
  if (typeof fallbackRaw === "object" && fallbackRaw !== null && !Array.isArray(fallbackRaw)) {
    const raw = fallbackRaw as Record<string, unknown>;
    const complete =
      readString(raw, "provider") &&
      readString(raw, "model") &&
      readString(raw, "api_key") &&
      readString(raw, "base_url");
    if (complete) fallback = parseOpenAiSection(raw, "judge_fallback");
  }
  return {
    kind: "jev",
    apiKey,
    endpoint: readString(section, "base_url") ?? DEFAULT_JEV_ENDPOINT,
    model: readString(section, "model") ?? DEFAULT_JEV_MODEL,
    fallback,
  };
}
