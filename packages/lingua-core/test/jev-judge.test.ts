import { describe, expect, it } from "vitest";
import {
  DEFAULT_JEV_ENDPOINT,
  DEFAULT_JEV_MODEL,
  JEV_USAGE_QUESTION_ID,
  buildJevUsageRequest,
  createFallbackUsageJudge,
  createJevUsageJudge,
  parseJevUsageVerdict,
  parseJudgeSelection,
} from "../src/index";
import type { JevSystemOneRequest, JevTransport, UsageJudgeInput } from "../src/index";

// Jev 判分适配器（issue #17，ADR-0010）：Jev = TypeSafe System One 决策模型，
// 官方 endpoint POST {base}/systemone，请求 {model, state, questions}，问题类型
// noul = 是/否概率。适配器只负责协议解析与健壮性，真实 HTTP 走可注入
// transport（壳层实现）；非 2xx / 超时 / 响应缺字段由 transport 或解析层
// throw，交给 createFallbackUsageJudge 降级到 LLM 判分。

const baseInput: UsageJudgeInput = {
  userText: "I'm looking for a post about agents.",
  chunk: {
    chunkId: "chunk-1",
    canonicalForm: "look for",
    surface: "looking for",
    matchedForm: "looking for",
  },
  exposedRecently: true,
  topicText: "what are you reading these days?",
};

describe("buildJevUsageRequest：把判分输入映射成 System One 请求", () => {
  it("carries the model, the state evidence and one noul question on usage correctness", () => {
    const request = buildJevUsageRequest(baseInput, "jev-latest");

    expect(request.model).toBe("jev-latest");
    expect(request.state.user_text).toBe(baseInput.userText);
    expect(request.state.chunk_canonical_form).toBe("look for");
    expect(request.state.chunk_surface).toBe("looking for");
    expect(request.state.matched_form).toBe("looking for");
    expect(request.state.topic_text).toBe(baseInput.topicText);
    // state 只放文本（Jev 只读文本），布尔证据降级为字符串。
    expect(request.state.exposed_recently).toBe("yes");
    const question = request.questions[JEV_USAGE_QUESTION_ID]!;
    expect(question.type).toBe("noul");
    expect(question.instructions).toMatch(/用法|正确/);
  });
});

describe("parseJevUsageVerdict：协议解析与健壮性", () => {
  const answer = (noul: unknown, type = "noul") => ({
    model: "jev-1.13.0",
    answers: { [JEV_USAGE_QUESTION_ID]: { type, noul } },
    usage: { input_tokens: 100, output_tokens: 0 },
  });

  it("maps noul >= 0.5 to correct with the probability as confidence", () => {
    expect(parseJevUsageVerdict(answer(0.9))).toEqual({ outcome: "correct", confidence: 0.9 });
    expect(parseJevUsageVerdict(answer(0.5))).toEqual({ outcome: "correct", confidence: 0.5 });
  });

  it("maps noul < 0.5 to wrong with the complementary probability as confidence", () => {
    expect(parseJevUsageVerdict(answer(0.2))).toEqual({ outcome: "wrong", confidence: 0.8 });
  });

  it("clamps out-of-range probabilities into [0, 1]", () => {
    expect(parseJevUsageVerdict(answer(1.7))).toEqual({ outcome: "correct", confidence: 1 });
    expect(parseJevUsageVerdict(answer(-0.4))).toEqual({ outcome: "wrong", confidence: 1 });
  });

  it("throws on malformed responses (not an object, missing answers or missing noul)", () => {
    expect(() => parseJevUsageVerdict(null)).toThrow(/Jev/);
    expect(() => parseJevUsageVerdict("ok")).toThrow(/Jev/);
    expect(() => parseJevUsageVerdict({})).toThrow(/Jev/);
    expect(() => parseJevUsageVerdict({ answers: {} })).toThrow(/Jev/);
    expect(() => parseJevUsageVerdict(answer(undefined))).toThrow(/Jev/);
    expect(() => parseJevUsageVerdict(answer("0.9"))).toThrow(/Jev/);
    expect(() => parseJevUsageVerdict(answer(Number.NaN))).toThrow(/Jev/);
  });
});

describe("createJevUsageJudge：transport 注入的判分器", () => {
  it("sends the built request to the transport and parses the verdict", async () => {
    let seen: JevSystemOneRequest | null = null;
    const transport: JevTransport = async (request) => {
      seen = request;
      return { answers: { [JEV_USAGE_QUESTION_ID]: { type: "noul", noul: 0.86 } } };
    };
    const judge = createJevUsageJudge({ transport, model: "jev-1.13.0" });

    const verdict = await judge.judgeUsage(baseInput);

    expect(verdict).toEqual({ outcome: "correct", confidence: 0.86 });
    expect(seen!.model).toBe("jev-1.13.0");
    expect(seen!.questions[JEV_USAGE_QUESTION_ID]!.type).toBe("noul");
  });

  it("defaults to the pinned public endpoint model and identifies itself", () => {
    const judge = createJevUsageJudge({ transport: async () => ({ answers: {} }) });
    expect(judge.name).toBe("jev-usage");
    expect(judge.version).toBe("1");
  });

  it("propagates transport errors so the fallback layer can react", async () => {
    const judge = createJevUsageJudge({
      transport: async () => {
        throw new Error("HTTP 529 overloaded");
      },
    });
    await expect(judge.judgeUsage(baseInput)).rejects.toThrow("HTTP 529");
  });
});

describe("createFallbackUsageJudge：主判分失败降级到 LLM", () => {
  const llmVerdict = { outcome: "wrong" as const, confidence: 0.7 };

  it("passes the primary verdict through without calling the fallback", async () => {
    let fallbackCalled = false;
    const judge = createFallbackUsageJudge({
      primary: {
        name: "jev-usage",
        version: "1",
        judgeUsage: async () => ({ outcome: "correct", confidence: 0.9 }),
      },
      fallback: {
        name: "llm-usage",
        version: "1",
        judgeUsage: async () => {
          fallbackCalled = true;
          return llmVerdict;
        },
      },
    });

    const verdict = await judge.judgeUsage(baseInput);
    expect(verdict).toEqual({ outcome: "correct", confidence: 0.9 });
    expect(fallbackCalled).toBe(false);
  });

  it("falls back to the LLM verdict when the primary throws", async () => {
    const errors: unknown[] = [];
    let fallbackInput: UsageJudgeInput | null = null;
    const judge = createFallbackUsageJudge({
      primary: {
        name: "jev-usage",
        version: "1",
        judgeUsage: async () => {
          throw new Error("HTTP 429");
        },
      },
      fallback: {
        name: "llm-usage",
        version: "1",
        judgeUsage: async (input) => {
          fallbackInput = input;
          return llmVerdict;
        },
      },
      onFallback: (error) => errors.push(error),
    });

    const verdict = await judge.judgeUsage(baseInput);
    expect(verdict).toEqual(llmVerdict);
    expect(fallbackInput).toEqual(baseInput);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("HTTP 429");
  });

  it("exposes the primary and fallback chain in its name", () => {
    const judge = createFallbackUsageJudge({
      primary: { name: "jev-usage", version: "1", judgeUsage: async () => llmVerdict },
      fallback: { name: "llm-usage", version: "1", judgeUsage: async () => llmVerdict },
    });
    expect(judge.name).toBe("jev-usage→llm-usage");
  });
});

describe("parseJudgeSelection：判分配置项解析（合法/非法值）", () => {
  const main = { provider: "deepseek", model: "deepseek-chat", apiKey: "k", baseUrl: "https://api.deepseek.com/v1" };
  const jevSection = { provider: "jev", api_key: "jev-key" };
  const llmSection = {
    provider: "qwen",
    model: "qwen-flash",
    api_key: "q-key",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  };

  it("defaults to the llm judge on the main model when no judge section exists", () => {
    const selection = parseJudgeSelection(undefined, undefined, main);
    expect(selection).toEqual({ kind: "llm", judge: main });
  });

  it("parses the jev judge with defaults for endpoint and model", () => {
    const selection = parseJudgeSelection(jevSection, undefined, main);
    expect(selection).toMatchObject({
      kind: "jev",
      apiKey: "jev-key",
      endpoint: DEFAULT_JEV_ENDPOINT,
      model: DEFAULT_JEV_MODEL,
      fallback: main,
    });
  });

  it("uses the judge_fallback section as the jev fallback when fully configured", () => {
    const selection = parseJudgeSelection(jevSection, llmSection, main);
    expect(selection.kind).toBe("jev");
    if (selection.kind === "jev") {
      expect(selection.fallback).toEqual({
        provider: "qwen",
        model: "qwen-flash",
        apiKey: "q-key",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      });
    }
  });

  it("parses an OpenAI-compatible judge section as the llm judge", () => {
    const selection = parseJudgeSelection(llmSection, undefined, main);
    expect(selection).toEqual({ kind: "llm", judge: expect.objectContaining({ provider: "qwen" }) });
  });

  it("rejects a jev judge without an api key", () => {
    expect(() => parseJudgeSelection({ provider: "jev" }, undefined, main)).toThrow(/api_key/);
    expect(() => parseJudgeSelection({ provider: "jev", api_key: "" }, undefined, main)).toThrow(/api_key/);
  });

  it("rejects an llm judge section missing OpenAI-compatible fields", () => {
    expect(() => parseJudgeSelection({ provider: "qwen" }, undefined, main)).toThrow(/缺 model/);
    expect(() => parseJudgeSelection({ provider: "qwen", base_url: "u", model: "m", api_key: "" }, undefined, main)).toThrow(/api_key/);
  });

  it("rejects non-object judge sections", () => {
    expect(() => parseJudgeSelection("jev", undefined, main)).toThrow(/models.judge/);
  });
});
