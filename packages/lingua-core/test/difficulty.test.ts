import { describe, expect, it } from "vitest";
import type { Cefr } from "../src/index";
import { openDifficultyPipeline, type Wordlist } from "../src/index";

// 测试词表为极小的内置假词表（EFLLex 是 CC BY-NC-SA，词表数据不入库、测试不下载真词表）。
// 键是词形还原后的 lemma（与判分管道同一 lemmatizer：is/are → be）。
const WORDS: Record<string, Cefr> = {
  the: "A1", cat: "A1", dog: "A1", fish: "A1", bird: "A1",
  be: "A1", big: "A1", small: "A1", good: "A1",
  red: "A1", blue: "A1", and: "A1", i: "A1", like: "A1",
  village: "A2", river: "A2",
  however: "B1", government: "B1", increase: "B1",
  substantial: "B2",
  ubiquitous: "C1",
};

function fakeWordlist(entries: Record<string, Cefr> = WORDS): Wordlist {
  return { lookup: (lemma) => entries[lemma] ?? null };
}

describe("难度管道 L1：EFLLex 式累计覆盖率（95% 阈值定解锁级）", () => {
  it("固定文本样本的难度级与覆盖率输出可复现", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    // 全 A1 短句：the×3 cat×2 is×3 big×1 dog×1 small×1 i×1 like×1 = 13 token，3 句。
    const sample = "The cat is big. The dog is small. I like the cat.";
    const first = await pipeline.assess({ text: sample });
    const second = await pipeline.assess({ text: sample });
    expect(second).toEqual(first);
    expect(first.level).toBe("A1");
    expect(first.coverage).toBe(1);
    expect(first.perishability).toBe("evergreen");
  });

  it("解锁级 = 首个累计覆盖率达 95% 的级别", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    // 23 A1 + 2 A2 + 3 B1 + 1 B2 + 1 off-list = 30 token：
    // cov(A1)≈0.767，cov(A2)≈0.833，cov(B1)≈0.933，cov(B2)≈0.967 → B2。
    const sample =
      "The cat is big and the dog is small and the fish is red and the bird is blue " +
      "and the village and the river however government increase substantial zzzqw.";
    const result = await pipeline.assess({ text: sample });
    expect(result.level).toBe("B2");
    expect(result.coverage).toBeCloseTo(29 / 30, 10);
  });

  it("阈值恰达 0.95 即解锁（≥ 语义）", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    // 21 A1 + 1 A2 + 1 B1 = 23 token：cov(A1)≈0.913 < 0.95，cov(A2)≈0.957 ≥ 0.95 → A2。
    const sample =
      "The cat is big and the dog is small and the fish is red and the bird is blue and the village however.";
    const result = await pipeline.assess({ text: sample });
    expect(result.level).toBe("A2");
    expect(result.coverage).toBeCloseTo(22 / 23, 10);
  });

  it("off-list 词计入最难档：任何级别都到不了 95% 时定 C2", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    const result = await pipeline.assess({ text: "Zzzqw zzzqx zzzqy the cat." });
    expect(result.level).toBe("C2");
    expect(result.coverage).toBe(1);
  });

  it("豁免数字与句中专名（不计入覆盖率分母）", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    // Sherlock 句中大写 → 专名豁免；3 → 数字豁免；分母只剩 the/cat/be/big 四个 A1。
    const result = await pipeline.assess({ text: "The cat Sherlock is big. The cat is 3." });
    expect(result.level).toBe("A1");
    expect(result.coverage).toBe(1);
  });

  it("覆盖率阈值是可校准参数", async () => {
    const pipeline = openDifficultyPipeline({
      wordlist: fakeWordlist(),
      coverageThreshold: 0.9,
    });
    const sample =
      "The cat is big and the dog is small and the fish is red and the bird is blue " +
      "and the village and the river however government increase substantial zzzqw.";
    const result = await pipeline.assess({ text: sample });
    expect(result.level).toBe("B1");
    expect(result.coverage).toBeCloseTo(28 / 30, 10);
  });
});

describe("难度管道 L2：平均句长约束", () => {
  it("L1 定为 A1 但平均句长超 12 词 → 上调 A2", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    // 16 个 A1 token 连成一句：cov(A1)=1 但平均句长 16 > 12。
    const sample = "The cat is big and the dog is small and the fish is red and blue.";
    const result = await pipeline.assess({ text: sample });
    expect(result.level).toBe("A2");
    expect(result.coverage).toBe(1);
  });

  it("多句拆短后不受 L2 约束", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    const sample = "The cat is big. The dog is small. The fish is red. The bird is blue.";
    const result = await pipeline.assess({ text: sample });
    expect(result.level).toBe("A1");
  });
});

describe("难度管道 L3：LLM 粗评三档交叉验证（不单独定级）", () => {
  const EASY = "The cat is big. The dog is small. I like the cat.";
  const HARD =
    "The cat is big and the dog is small and the fish is red and the bird is blue " +
    "and the village and the river however government increase substantial zzzqw.";

  it("L3 给出更难档位 → 级别抬到该档位地板", async () => {
    const pipeline = openDifficultyPipeline({
      wordlist: fakeWordlist(),
      grader: { grade: async () => "C" },
    });
    const result = await pipeline.assess({ text: EASY });
    expect(result.level).toBe("C1");
    expect(result.coverage).toBe(1);
  });

  it("L3 给出更容易的档位 → 永不下调", async () => {
    const pipeline = openDifficultyPipeline({
      wordlist: fakeWordlist(),
      grader: { grade: async () => "A" },
    });
    const result = await pipeline.assess({ text: HARD });
    expect(result.level).toBe("B2");
  });

  it("L3 出错即跳过：评估照常产出 L1+L2 结果", async () => {
    const pipeline = openDifficultyPipeline({
      wordlist: fakeWordlist(),
      grader: {
        grade: async () => {
          throw new Error("model unavailable");
        },
      },
    });
    const result = await pipeline.assess({ text: EASY });
    expect(result.level).toBe("A1");
  });
});

describe("时效标签（易腐/常青）", () => {
  const SAMPLE = "The cat is big. The dog is small.";

  it("URL 日期路径 → 易腐；普通链接与正文 → 常青", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    const dated = await pipeline.assess({
      text: SAMPLE,
      url: "https://news.example.com/2026/10/03/agent-release",
    });
    expect(dated.perishability).toBe("perishable");
    const plain = await pipeline.assess({ text: SAMPLE, url: "https://example.com/essays/attention" });
    expect(plain.perishability).toBe("evergreen");
  });

  it("正文时间状语标记 → 易腐", async () => {
    const pipeline = openDifficultyPipeline({ wordlist: fakeWordlist() });
    const result = await pipeline.assess({ text: "The cat is big today. The dog is small." });
    expect(result.perishability).toBe("perishable");
  });

  it("注入 tagger 时以 tagger 为准（系统顺手标注）", async () => {
    const pipeline = openDifficultyPipeline({
      wordlist: fakeWordlist(),
      tagger: { tag: async () => "perishable" },
    });
    const result = await pipeline.assess({ text: SAMPLE });
    expect(result.perishability).toBe("perishable");
  });

  it("tagger 出错退化为确定性启发式", async () => {
    const pipeline = openDifficultyPipeline({
      wordlist: fakeWordlist(),
      tagger: {
        tag: async () => {
          throw new Error("model unavailable");
        },
      },
    });
    const result = await pipeline.assess({ text: SAMPLE });
    expect(result.perishability).toBe("evergreen");
  });
});
