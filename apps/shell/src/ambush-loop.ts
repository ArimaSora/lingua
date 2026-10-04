import { generateText, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  buildJudgePrompt,
  createFallbackUsageJudge,
  createJevUsageJudge,
  createJudge,
  type Ambush,
  type Clock,
  type Database,
  type EventStore,
  type Judge,
  type JudgeModelConfig,
  type JudgeSelection,
  type MessageStore,
  type UsageJudge,
  type UsageVerdict,
} from "@lingua/core";
import { createJevHttpTransport } from "./jev-transport";

// 埋伏复习运行时接线（issue #07 壳层侧，ADR-0017 真接缝）：
// - 每轮对话确保有开放话题（有料才起，core 记配额），把话题生成提示注入
//   角色 system prompt——角色自然起话题，不泄题；
// - 用户回合结束后结算：规则命中（core matchChunks）+ LLM 判用法正误
//   （ADR-0010，Jev/任意 OpenAI 兼容模型；e2e 注入假判分器）；
// - 近期是否暴露由核心按近期角色消息确定性判定（ADR-0013），壳层只搬运文本。

export function createLlmUsageJudge(model: LanguageModel): UsageJudge {
  return {
    name: "llm-usage",
    version: "1",
    async judgeUsage(input): Promise<UsageVerdict> {
      const result = await generateText({
        model,
        prompt: buildJudgePrompt(input),
        maxOutputTokens: 200,
      });
      const parsed = JSON.parse(extractJsonObject(result.text)) as {
        outcome?: unknown;
        confidence?: unknown;
      };
      if (parsed.outcome !== "correct" && parsed.outcome !== "wrong") {
        throw new Error(`判分输出无法解析：${result.text.slice(0, 120)}`);
      }
      const confidence =
        typeof parsed.confidence === "number" &&
        Number.isFinite(parsed.confidence)
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5;
      return { outcome: parsed.outcome, confidence };
    },
  };
}

// 模型有时把 JSON 包在 ```json 代码块或前后散文里——取第一个 {...} 平衡块。
function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`判分输出不含 JSON：${text.slice(0, 120)}`);
  }
  return text.slice(start, end + 1);
}

export type AmbushLoop = {
  // 本轮要注入角色 system prompt 的话题生成提示；无话题（配额尽/无候选）返回 null。
  topicPromptForTurn(): string | null;
  // 结算用户回合：若本轮开场时有开放话题，则用 Judge 判分并写事件流。
  // 判分器失败不阻断对话（话题保持 open，stale 后由核心回炉）。
  settleUserTurn(userText: string): Promise<void>;
};

export type AmbushLoopDeps = {
  db: Database;
  clock: Clock;
  language: string;
  ambush: Ambush;
  eventStore: EventStore;
  store: MessageStore;
  judge: Judge;
  // 暴露检测回看多少条角色消息（ADR-0013「近几轮」）；默认 8。
  recentAssistantMessages?: number;
};

export function createAmbushLoop(deps: AmbushLoopDeps): AmbushLoop {
  const recentLimit = deps.recentAssistantMessages ?? 8;
  let activeTopicId: string | null = null;

  return {
    topicPromptForTurn() {
      const topic = deps.ambush.openTopic(deps.language);
      if (!topic) {
        activeTopicId = null;
        return null;
      }
      activeTopicId = topic.topicId;
      return topic.prompt;
    },

    async settleUserTurn(userText) {
      const topicId = activeTopicId;
      activeTopicId = null;
      if (!topicId) return;
      // ADR-0013：近期暴露的示范既算角色消息，也算系统消息（系统推送里的语块形式）。
      const recentCompanionTexts = (["companion", "system"] as const).flatMap((contact) =>
        deps.store.list({ language: deps.language, contact, limit: recentLimit }),
      )
        .filter((message) => message.role === "assistant")
        .map((message) => message.text);
      try {
        await deps.ambush.resolveTopic({
          topicId,
          userText,
          judge: deps.judge,
          store: deps.eventStore,
          recentCompanionTexts,
        });
      } catch (error) {
        // 传感器（LLM）故障 ≠ 学习者没产出：本轮不记任何证据，话题留待重试或回炉。
        console.error(`埋伏判分失败（话题 ${topicId}）：${(error as Error).message}`);
      }
    },
  };
}

function judgeModelToLanguageModel(config: JudgeModelConfig): LanguageModel {
  return createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  }).chatModel(config.model);
}

// 判分装配（issue #17，ADR-0010）：按配置选择判分通道——缺省 / llm = LLM 判用法
// （OpenAI 兼容）；jev = Jev 主判分 + LLM 降级（Jev 非 2xx / 超时 / 响应不可解析
// 时落到 fallback，保住判分通道）。options.judge 注入优先级高于此处（冒烟不受影响）。
export function createDefaultJudge(
  db: Database,
  model: LanguageModel,
  selection?: JudgeSelection,
): Judge {
  if (!selection || selection.kind === "llm") {
    const llmModel = selection ? judgeModelToLanguageModel(selection.judge) : model;
    return createJudge({ db, usageJudge: createLlmUsageJudge(llmModel) });
  }
  const fallback = createLlmUsageJudge(judgeModelToLanguageModel(selection.fallback));
  const jev = createJevUsageJudge({
    transport: createJevHttpTransport({
      apiKey: selection.apiKey,
      endpoint: selection.endpoint,
    }),
    model: selection.model,
  });
  const usageJudge: UsageJudge = createFallbackUsageJudge({
    primary: jev,
    fallback,
    onFallback: (error) => {
      console.warn(`Jev 判分失败，降级到 LLM：${(error as Error).message}`);
    },
  });
  return createJudge({ db, usageJudge });
}
