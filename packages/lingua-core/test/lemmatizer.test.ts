import { describe, expect, it } from "vitest";
import { lemmatizeWord, tokenize } from "../src/index";

describe("lemmatizeWord", () => {
  // 命中判定与（后续）难度管道共用同一还原函数（ADR-0010/0012）：
  // 不要求语言学完美，要求同一词形的所有屈折变化收敛到同一 lemma。
  it.each([
    { forms: ["look", "looks", "looked", "looking"], lemma: "look" },
    { forms: ["take", "takes", "took", "taken", "taking"], lemma: "take" },
    { forms: ["go", "goes", "went", "gone"], lemma: "go" },
    { forms: ["study", "studies", "studied"], lemma: "study" },
    { forms: ["word", "words"], lemma: "word" },
    { forms: ["child", "children"], lemma: "child" },
    { forms: ["do", "does", "did"], lemma: "do" },
    { forms: ["run", "runs", "ran", "running"], lemma: "run" },
    { forms: ["good", "better"], lemma: "good" },
  ])("$forms all reduce to $lemma", ({ forms, lemma }) => {
    for (const form of forms) {
      expect(lemmatizeWord(form)).toBe(lemma);
    }
  });

  it("folds case and strips possessives", () => {
    expect(lemmatizeWord("Looked")).toBe("look");
    expect(lemmatizeWord("LOOKS")).toBe("look");
    expect(lemmatizeWord("teacher's")).toBe("teacher");
    expect(lemmatizeWord("it’s")).toBe("it");
  });

  it("leaves function words and particles untouched", () => {
    for (const word of ["up", "it", "the", "an", "off", "out"]) {
      expect(lemmatizeWord(word)).toBe(word);
    }
  });
});

describe("tokenize", () => {
  it("splits text into tokens with char offsets and lemmas", () => {
    const tokens = tokenize("Look it up, please!");
    expect(tokens.map((t) => t.raw)).toEqual(["Look", "it", "up", "please"]);
    expect(tokens.map((t) => t.lemma)).toEqual(["look", "it", "up", "please"]);
    expect(tokens.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    // 偏移指向原文：surface 可由 start/end 切出。
    expect(tokens[0]).toMatchObject({ start: 0, end: 4 });
    expect("Look it up, please!".slice(tokens[2]!.start, tokens[2]!.end)).toBe("up");
  });

  it("keeps contractions as single tokens and skips punctuation/emoji", () => {
    const tokens = tokenize("I don't… really");
    expect(tokens.map((t) => t.raw)).toEqual(["I", "don't", "really"]);
  });
});
