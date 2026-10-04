import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { MainModelConfig } from "./config";

// 模型密钥运行时注入：允许无密钥启动（零配置开箱），密钥经系统会话
// 「设置密钥」命令在启动后填入、即刻生效（无需重启）。所有模型消费方
// （角色对话、讲解、判分降级、改写）每次调用经 get() 取当前模型——
// 未配置时抛出带指引的友好错误，而不是启动即崩溃。

export const UNCONFIGURED_MODEL_MESSAGE =
  "主模型密钥未配置：在系统会话发送「设置密钥 <你的 API key>」立即启用（无需重启），" +
  "或在 config.toml 的 [models.main] 填入 api_key 后重启。";

export type ModelSource = {
  // 每次调用取当前模型；未配置时抛 UNCONFIGURED_MODEL_MESSAGE。
  get(): LanguageModel;
  configured(): boolean;
  // 填入/更换密钥，立即重建底层模型。
  setApiKey(apiKey: string): void;
};

export function createModelRegistry(initial: MainModelConfig): ModelSource {
  let model: LanguageModel | null = initial.apiKey ? build(initial, initial.apiKey) : null;
  return {
    get() {
      if (!model) throw new Error(UNCONFIGURED_MODEL_MESSAGE);
      return model;
    },
    configured: () => model !== null,
    setApiKey(apiKey) {
      model = build(initial, apiKey);
    },
  };
}

function build(config: MainModelConfig, apiKey: string): LanguageModel {
  return createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseUrl,
    apiKey,
  }).chatModel(config.model);
}

// e2e 冒烟等注入路径：固定模型，密钥命令无效果。
export function constantModelSource(model: LanguageModel): ModelSource {
  return {
    get: () => model,
    configured: () => true,
    setApiKey() {
      /* 注入模型不接受运行时换钥 */
    },
  };
}
