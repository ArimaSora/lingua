import { describe, expect, it } from "vitest";
import { addRelationshipFact, getCharacterCard, loadCharacterCard, parseCharacterCard, renderDigest } from "../src/index";
import { makeHarness } from "./helpers";

describe("parseCharacterCard（角色卡：人格基底 + Lingua 扩展字段）", () => {
  it("接受完整角色卡并保留全部字段", () => {
    const card = parseCharacterCard({
      name: "Maya",
      persona: "网聊风格的英语朋友，短回复，聊 agent 与编程",
      interests: ["AI agents", "indie hacking"],
      scaffoldingTier: "on-request",
      registerRange: { from: "casual", to: "neutral" },
      languagePair: { native: "zh", target: "en" },
    });

    expect(card).toEqual({
      name: "Maya",
      persona: "网聊风格的英语朋友，短回复，聊 agent 与编程",
      interests: ["AI agents", "indie hacking"],
      scaffoldingTier: "on-request",
      registerRange: { from: "casual", to: "neutral" },
      languagePair: { native: "zh", target: "en" },
    });
  });

  it("扩展字段缺省时给默认值：兴趣空、full-support 档、语域 casual–neutral、语言对 zh→en", () => {
    const card = parseCharacterCard({ name: "Maya", persona: "…" });

    expect(card.interests).toEqual([]);
    expect(card.scaffoldingTier).toBe("full-support");
    expect(card.registerRange).toEqual({ from: "casual", to: "neutral" });
    expect(card.languagePair).toEqual({ native: "zh", target: "en" });
  });

  it("拒绝缺名字或人格基底的卡片", () => {
    expect(() => parseCharacterCard({ persona: "…" })).toThrow();
    expect(() => parseCharacterCard({ name: "Maya" })).toThrow();
    expect(() => parseCharacterCard({ name: "  ", persona: "…" })).toThrow();
    expect(() => parseCharacterCard("Maya")).toThrow();
  });

  it("拒绝非法扩展字段：未知支架档位、未知语域、语域范围颠倒、兴趣非字符串数组", () => {
    const base = { name: "Maya", persona: "…" };
    expect(() => parseCharacterCard({ ...base, scaffoldingTier: "B1" })).toThrow();
    expect(() =>
      parseCharacterCard({ ...base, registerRange: { from: "vulgar", to: "casual" } }),
    ).toThrow();
    expect(() =>
      parseCharacterCard({ ...base, registerRange: { from: "formal", to: "casual" } }),
    ).toThrow();
    expect(() => parseCharacterCard({ ...base, interests: "agents" })).toThrow();
    expect(() =>
      parseCharacterCard({ ...base, languagePair: { native: "zh" } }),
    ).toThrow();
  });
});

describe("loadCharacterCard / getCharacterCard（角色卡持久化，按语言隔离）", () => {
  it("加载后按目标语言读回同一张卡", () => {
    const { db, clock } = makeHarness();
    loadCharacterCard({
      db,
      clock,
      card: {
        name: "Maya",
        persona: "网聊风格的英语朋友",
        interests: ["AI agents"],
        scaffoldingTier: "on-request",
        registerRange: { from: "casual", to: "formal" },
        languagePair: { native: "zh", target: "en" },
      },
    });

    expect(getCharacterCard({ db, language: "en" })).toEqual({
      name: "Maya",
      persona: "网聊风格的英语朋友",
      interests: ["AI agents"],
      scaffoldingTier: "on-request",
      registerRange: { from: "casual", to: "formal" },
      languagePair: { native: "zh", target: "en" },
    });
    expect(getCharacterCard({ db, language: "ja" })).toBeNull();
  });
});

describe("角色卡 → digest 输入（issue #5 下沉规则）", () => {
  it("卡片兴趣层经策展事实进入 digest「角色须知」段", () => {
    const { db, clock } = makeHarness();
    loadCharacterCard({
      db,
      clock,
      card: {
        name: "Maya",
        persona: "网聊风格的英语朋友",
        interests: ["AI agents", "indie hacking"],
      },
    });

    const digest = renderDigest({ db, clock, language: "en" });

    expect(digest.text).toContain("角色须知");
    expect(digest.text).toContain("用户与角色 Maya 的共同兴趣：AI agents、indie hacking");
  });

  it("无兴趣层的卡片不产生策展事实", () => {
    const { db, clock } = makeHarness();
    loadCharacterCard({ db, clock, card: { name: "Maya", persona: "…" } });

    const digest = renderDigest({ db, clock, language: "en" });

    expect(digest.text).toBe("");
  });

  it("重复加载幂等：同一语言只保留一张卡，事实不重复", () => {
    const { db, clock } = makeHarness();
    const input = { name: "Maya", persona: "…", interests: ["AI agents"] };
    const first = loadCharacterCard({ db, clock, card: input });
    const second = loadCharacterCard({
      db,
      clock,
      card: { ...input, persona: "被覆盖的人格" },
    });

    expect(second).toEqual(first);
    const rows = db
      .prepare("SELECT fact FROM relationship_facts WHERE language = 'en'")
      .all() as unknown as { fact: string }[];
    expect(rows).toHaveLength(1);
  });
});

describe("addRelationshipFact（关系记忆写入）", () => {
  it("追加的策展事实出现在 digest「角色须知」段", () => {
    const { db, clock } = makeHarness();
    loadCharacterCard({ db, clock, card: { name: "Maya", persona: "…" } });

    addRelationshipFact({ db, clock, language: "en", fact: "用户在做 agent 方向的副业项目" });

    const digest = renderDigest({ db, clock, language: "en" });
    expect(digest.text).toContain("用户在做 agent 方向的副业项目");
  });

  it("该语言没有角色卡时拒绝写入", () => {
    const { db, clock } = makeHarness();
    expect(() =>
      addRelationshipFact({ db, clock, language: "en", fact: " orphaned " }),
    ).toThrow();
  });
});
