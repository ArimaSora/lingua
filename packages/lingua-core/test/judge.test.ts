import { describe, expect, it } from "vitest";
import { buildJudgePrompt, createJudge } from "../src/index";
import type { UsageJudge, UsageJudgeInput } from "../src/index";
import { insertChunk, makeHarness } from "./helpers";

// Judge 接口（issue #7，ADR-0010/0017 真接缝）：判分器输出**证据**（辅助情况 ×
// 产出结果 + 置信度），事件结论由票 01 管线派生。组合规则：命中判定 = 确定性
// 规则（票 02 词形还原 + 字符串匹配）；用法正误 = LLM 判分（Jev 主 / Qwen 降级，
// 测试用 fake）。语块缺席由规则独立判定（未产出 = 未获得证据），不消耗 LLM。

function fakeUsageJudge(
  verdict: { outcome: "correct" | "wrong"; confidence: number },
  onCall?: (input: UsageJudgeInput) => void,
): UsageJudge {
  return {
    name: "fake-usage",
    version: "0.1",
    async judgeUsage(input) {
      onCall?.(input);
      return verdict;
    },
  };
}

const throwingUsageJudge: UsageJudge = {
  name: "should-not-be-called",
  version: "0",
  async judgeUsage() {
    throw new Error("语块缺席由规则判定，不得调用 LLM 判分");
  },
};

describe("createJudge：规则命中 + 用法判分组合", () => {
  it("matched chunk is judged for usage correctness with surface and exposure context", async () => {
    const { db } = makeHarness();
    insertChunk(db, "chunk-1", { form: "look for" });
    let seen: UsageJudgeInput | null = null;
    const judge = createJudge({
      db,
      usageJudge: fakeUsageJudge({ outcome: "correct", confidence: 0.92 }, (input) => {
        seen = input;
      }),
    });

    const verdicts = await judge.judge({
      userText: "I'm looking for a post about agents.",
      targets: [{ chunkId: "chunk-1", exposedRecently: false }],
      topicText: "what are you reading these days?",
    });

    expect(verdicts).toEqual([
      { chunkId: "chunk-1", outcome: "correct", confidence: 0.92, quote: "looking for" },
    ]);
    expect(seen!.chunk.canonicalForm).toBe("look for");
    expect(seen!.chunk.surface).toBe("looking for");
    expect(seen!.exposedRecently).toBe(false);
    expect(seen!.userText).toBe("I'm looking for a post about agents.");
    expect(seen!.topicText).toBe("what are you reading these days?");
  });

  it("absent chunk is not-produced by rule alone, without calling the usage judge", async () => {
    const { db } = makeHarness();
    insertChunk(db, "chunk-1", { form: "look for" });
    const judge = createJudge({ db, usageJudge: throwingUsageJudge });

    const verdicts = await judge.judge({
      userText: "I found a great post about agents.",
      targets: [{ chunkId: "chunk-1", exposedRecently: false }],
    });

    // 未产出 = 未获得证据（ADR-0013）：替代正确表达同样达成交际目标，永不记失败。
    expect(verdicts).toEqual([
      { chunkId: "chunk-1", outcome: "not-produced", confidence: 1, quote: "" },
    ]);
  });

  it("judges every target independently over one scan of the user text", async () => {
    const { db } = makeHarness();
    insertChunk(db, "chunk-hit", { form: "thanks a lot" });
    insertChunk(db, "chunk-miss", { form: "see you around" });
    const judge = createJudge({
      db,
      usageJudge: fakeUsageJudge({ outcome: "wrong", confidence: 0.8 }),
    });

    const verdicts = await judge.judge({
      userText: "thanks a lot for the link!",
      targets: [
        { chunkId: "chunk-hit", exposedRecently: true },
        { chunkId: "chunk-miss", exposedRecently: false },
      ],
    });

    expect(verdicts).toEqual([
      { chunkId: "chunk-hit", outcome: "wrong", confidence: 0.8, quote: "thanks a lot" },
      { chunkId: "chunk-miss", outcome: "not-produced", confidence: 1, quote: "" },
    ]);
  });

  it("identifies the judging pipeline as rule + the usage judge", () => {
    const { db } = makeHarness();
    const judge = createJudge({
      db,
      usageJudge: { name: "jev", version: "1.0", judgeUsage: throwingUsageJudge.judgeUsage },
    });
    expect(judge.name).toBe("rule+jev");
    expect(judge.version).toBe("1.0");
  });
});

describe("buildJudgePrompt：判分 prompt 携带「近期是否暴露该语块」标记（ADR-0013）", () => {
  const base = {
    userText: "I look for my keys everywhere.",
    chunk: {
      chunkId: "chunk-1",
      canonicalForm: "look for",
      surface: "look for",
      matchedForm: "look for",
    },
    topicText: "did you lose anything recently?",
  };

  it("marks recent exposure explicitly, both ways", () => {
    const exposed = buildJudgePrompt({ ...base, exposedRecently: true });
    const fresh = buildJudgePrompt({ ...base, exposedRecently: false });

    expect(exposed).toContain("近期是否暴露：是");
    expect(fresh).toContain("近期是否暴露：否");
  });

  it("carries the user text, the chunk form, the matched surface and the topic context", () => {
    const prompt = buildJudgePrompt({ ...base, exposedRecently: false });

    expect(prompt).toContain("I look for my keys everywhere.");
    expect(prompt).toContain("look for");
    expect(prompt).toContain("did you lose anything recently?");
  });

  it("asks for usage correctness only (presence is already decided by rules) and JSON output", () => {
    const prompt = buildJudgePrompt({ ...base, exposedRecently: false });

    expect(prompt).toMatch(/用法|正误/);
    expect(prompt).toContain('"outcome"');
    expect(prompt).toContain('"confidence"');
  });
});
