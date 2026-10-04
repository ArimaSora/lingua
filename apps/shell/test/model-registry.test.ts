import { describe, expect, it } from "vitest";
import {
  constantModelSource,
  createModelRegistry,
  UNCONFIGURED_MODEL_MESSAGE,
} from "../src/model-registry";
import { DEFAULT_MAIN_CONFIG } from "../src/config";

// 模型注册表（零配置启动）：未配置时 get() 抛带指引的友好错误；
// setApiKey 后即刻可用，无需重启。e2e 注入路径用 constantModelSource。

describe("createModelRegistry", () => {
  it("空密钥：configured() 为 false，get() 抛带「设置密钥」指引的错误", () => {
    const source = createModelRegistry({ ...DEFAULT_MAIN_CONFIG, apiKey: "" });
    expect(source.configured()).toBe(false);
    expect(() => source.get()).toThrowError(UNCONFIGURED_MODEL_MESSAGE);
    expect(() => source.get()).toThrow(/设置密钥/);
  });

  it("setApiKey 后即刻可用（无需重启）", () => {
    const source = createModelRegistry({ ...DEFAULT_MAIN_CONFIG, apiKey: "" });
    source.setApiKey("sk-runtime-key");
    expect(source.configured()).toBe(true);
    expect(source.get()).toBeTypeOf("object");
  });

  it("初始带密钥：直接可用", () => {
    const source = createModelRegistry({ ...DEFAULT_MAIN_CONFIG, apiKey: "sk-initial" });
    expect(source.configured()).toBe(true);
  });
});

describe("constantModelSource（e2e 注入路径）", () => {
  it("固定模型，始终 configured，换钥无效果", async () => {
    const { MockLanguageModelV4 } = await import("ai/test");
    const fake = new MockLanguageModelV4({ doGenerate: async () => ({ text: "ok" }) });
    const source = constantModelSource(fake);
    expect(source.configured()).toBe(true);
    expect(source.get()).toBe(fake);
    source.setApiKey("whatever");
    expect(source.get()).toBe(fake);
  });
});
