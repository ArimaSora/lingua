import { describe, expect, it } from "vitest";
import { matchChunks } from "../src/index";
import type { ChunkDescriptor } from "../src/index";

const lookUp: ChunkDescriptor = {
  id: "chunk-look-up",
  canonicalForm: "look up",
  chunkType: "collocation",
};

describe("matchChunks: 固定形式匹配", () => {
  it("locates an occurrence as a token interval with surface and char offsets", () => {
    const text = "I look up the word.";
    const { occurrences, scans } = matchChunks(text, [lookUp]);

    expect(occurrences).toHaveLength(1);
    // token 区间 [1, 3)：I / look / up / the / word
    expect(occurrences[0]).toMatchObject({
      chunkId: "chunk-look-up",
      startToken: 1,
      endToken: 3,
      surface: "look up",
      matchedForm: "look up",
    });
    expect(text.slice(occurrences[0]!.startChar, occurrences[0]!.endChar)).toBe("look up");
    expect(scans).toEqual([{ chunkId: "chunk-look-up", status: "matched" }]);
  });

  it("matches inflected surface forms via lemmas", () => {
    const { occurrences } = matchChunks("She looked up the answer yesterday.", [lookUp]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.surface).toBe("looked up");
  });

  it("reports not-found when the chunk does not occur", () => {
    const { occurrences, scans } = matchChunks("I give up.", [lookUp]);
    expect(occurrences).toHaveLength(0);
    expect(scans).toEqual([{ chunkId: "chunk-look-up", status: "not-found" }]);
  });
});

describe("matchChunks: 槽位模式", () => {
  const lookUpSlot: ChunkDescriptor = {
    id: "chunk-look-up",
    canonicalForm: "look up",
    chunkType: "collocation",
    slotPattern: "look ___ up",
  };

  it("matches split forms with a filled slot", () => {
    const { occurrences } = matchChunks("I looked the word up.", [lookUpSlot]);
    // I / looked / the / word / up
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      startToken: 1,
      endToken: 5,
      surface: "looked the word up",
      matchedForm: "look ___ up",
    });
  });

  it("locates the unsplit form with an empty slot (look up the word)", () => {
    const { occurrences } = matchChunks("Please look up the word.", [lookUpSlot]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      startToken: 1,
      endToken: 3,
      surface: "look up",
    });
  });

  it("finds every non-overlapping occurrence of the same chunk", () => {
    const { occurrences } = matchChunks("Look it up, then look it up again.", [lookUpSlot]);
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((o) => o.startToken)).toEqual([0, 4]);
  });

  it("does not match across a sentence break", () => {
    const { occurrences } = matchChunks("I looked it. Up next.", [lookUpSlot]);
    expect(occurrences).toHaveLength(0);
  });
});

describe("matchChunks: 重叠去重（长匹配优先）", () => {
  const lookUp: ChunkDescriptor = {
    id: "chunk-look-up",
    canonicalForm: "look up",
    chunkType: "collocation",
    slotPattern: "look ___ up",
  };
  const lookUpTo: ChunkDescriptor = {
    id: "chunk-look-up-to",
    canonicalForm: "look up to",
    chunkType: "idiom",
  };

  it("keeps the longest match when chunks overlap (ADR-0015)", () => {
    const text = "I really look up to her.";
    const { occurrences, scans } = matchChunks(text, [lookUp, lookUpTo]);

    // I / really / look / up / to / her：look up to [2,5) 与 look up [2,4) 重叠，长者胜。
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      chunkId: "chunk-look-up-to",
      startToken: 2,
      endToken: 5,
      surface: "look up to",
    });
    expect(scans).toEqual([
      { chunkId: "chunk-look-up", status: "not-found" },
      { chunkId: "chunk-look-up-to", status: "matched" },
    ]);
  });

  it("keeps both when matches of different chunks do not overlap", () => {
    const { occurrences } = matchChunks("I look it up because I look up to her.", [
      lookUp,
      lookUpTo,
    ]);
    expect(occurrences.map((o) => o.chunkId)).toEqual([
      "chunk-look-up",
      "chunk-look-up-to",
    ]);
  });

  it("is deterministic regardless of descriptor order", () => {
    const text = "I really look up to her.";
    const forward = matchChunks(text, [lookUp, lookUpTo]);
    const reverse = matchChunks(text, [lookUpTo, lookUp]);
    expect(reverse.occurrences).toEqual(forward.occurrences);
  });
});

describe("matchChunks: v1 支持类型之外不判失败（MVP 修订 5）", () => {
  it("reports unsupported instead of not-found, and never emits an occurrence", () => {
    const sentenceFrame: ChunkDescriptor = {
      id: "chunk-frame",
      canonicalForm: "the more the merrier-ish frame",
      chunkType: "sentence-frame",
    };
    const { occurrences, scans } = matchChunks("Anything at all.", [sentenceFrame]);

    expect(occurrences).toHaveLength(0);
    // unsupported ≠ not-found：调用方至多记观察机会（no-evidence），无从判失败；
    // 结果类型中根本没有「失败」这个分支。
    expect(scans).toEqual([{ chunkId: "chunk-frame", status: "unsupported" }]);
  });

  it("does not let an unsupported chunk block supported ones", () => {
    const { occurrences, scans } = matchChunks("I looked it up.", [
      { id: "chunk-frame", canonicalForm: "x", chunkType: "sentence-frame" },
      {
        id: "chunk-look-up",
        canonicalForm: "look up",
        chunkType: "collocation",
        slotPattern: "look ___ up",
      },
    ]);
    expect(occurrences).toHaveLength(1);
    expect(scans.map((s) => s.status)).toEqual(["unsupported", "matched"]);
  });
});

describe("matchChunks: 允许变体与形态优先级", () => {
  it("matches a variant surface form and reports it as matchedForm", () => {
    const descriptor: ChunkDescriptor = {
      id: "chunk-tia",
      canonicalForm: "take into account",
      chunkType: "collocation",
      variants: ["take into consideration"],
    };
    const { occurrences, scans } = matchChunks("They took into consideration our request.", [
      descriptor,
    ]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      startToken: 1,
      endToken: 4,
      surface: "took into consideration",
      matchedForm: "take into consideration",
    });
    expect(scans).toEqual([{ chunkId: "chunk-tia", status: "matched" }]);
  });

  it("prefers canonical over slot when both cover the same span", () => {
    const descriptor: ChunkDescriptor = {
      id: "chunk-look-up",
      canonicalForm: "look up",
      chunkType: "collocation",
      slotPattern: "look ___ up",
    };
    const { occurrences } = matchChunks("Look up.", [descriptor]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.matchedForm).toBe("look up");
  });

  it("prefers a variant over the slot pattern when both cover the same span", () => {
    const descriptor: ChunkDescriptor = {
      id: "chunk-look-up",
      canonicalForm: "look up",
      chunkType: "collocation",
      variants: ["look it up"],
      slotPattern: "look ___ up",
    };
    const { occurrences } = matchChunks("Look it up.", [descriptor]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.matchedForm).toBe("look it up");
  });
});
