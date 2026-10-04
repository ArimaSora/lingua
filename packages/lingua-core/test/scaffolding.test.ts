import { describe, expect, it } from "vitest";
import {
  acceptScaffoldingSuggestion,
  DEFAULT_SCAFFOLDING_TIER,
  effectiveRegisterRange,
  ensureLearnerProfile,
  formatScaffoldingSuggestion,
  getPendingSuggestion,
  getScaffoldingTier,
  parseScaffoldingTier,
  proposeScaffoldingTier,
  REGISTER_LABELS,
  registerCeiling,
  rejectScaffoldingSuggestion,
  scaffoldingPolicy,
  setScaffoldingTier,
  splitRegisterAnnotations,
} from "../src/index";
import { insertChunk, makeHarness, T0, DAY } from "./helpers";

describe("parseScaffoldingTier（母语支架档位，ADR-0004/0015）", () => {
  it("接受四档：A1–A2 全支架 / B1 求助才救场 / B2 澄清代替救场 / C1+ 全目标语", () => {
    expect(parseScaffoldingTier("full-support")).toBe("full-support");
    expect(parseScaffoldingTier("on-request")).toBe("on-request");
    expect(parseScaffoldingTier("clarify-only")).toBe("clarify-only");
    expect(parseScaffoldingTier("target-only")).toBe("target-only");
  });

  it("拒绝未知档位", () => {
    expect(() => parseScaffoldingTier("B1")).toThrow();
    expect(() => parseScaffoldingTier("")).toThrow();
    expect(() => parseScaffoldingTier(undefined)).toThrow();
  });
});

describe("scaffoldingPolicy（翻译折叠档位判断，issue #5）", () => {
  it("仅 full-support 档（A1–A2）的角色消息附可展开中文翻译", () => {
    expect(scaffoldingPolicy("full-support").attachL1Translation).toBe(true);
    expect(scaffoldingPolicy("on-request").attachL1Translation).toBe(false);
    expect(scaffoldingPolicy("clarify-only").attachL1Translation).toBe(false);
    expect(scaffoldingPolicy("target-only").attachL1Translation).toBe(false);
  });

  it("救场策略随档位渐退：无限制 → 明确求助 → 澄清请求 → 不用母语", () => {
    expect(scaffoldingPolicy("full-support").l1Rescue).toBe("unrestricted");
    expect(scaffoldingPolicy("on-request").l1Rescue).toBe("explicit-request");
    expect(scaffoldingPolicy("clarify-only").l1Rescue).toBe("clarify-only");
    expect(scaffoldingPolicy("target-only").l1Rescue).toBe("none");
  });

  it("默认档为 full-support（A1 起点，不做入学定级）", () => {
    expect(scaffoldingPolicy(DEFAULT_SCAFFOLDING_TIER)).toEqual({
      attachL1Translation: true,
      l1Rescue: "unrestricted",
    });
  });
});

describe("registerCeiling / effectiveRegisterRange（语域开放节奏跟随支架档位）", () => {
  it("full-support/on-request  ceiling 为 neutral；clarify-only/target-only 解锁 formal", () => {
    expect(registerCeiling("full-support")).toBe("neutral");
    expect(registerCeiling("on-request")).toBe("neutral");
    expect(registerCeiling("clarify-only")).toBe("formal");
    expect(registerCeiling("target-only")).toBe("formal");
  });

  it("在角色卡语域范围基础上按档位裁剪", () => {
    const casualToFormal = { from: "casual" as const, to: "formal" as const };
    expect(effectiveRegisterRange("full-support", casualToFormal)).toEqual({
      from: "casual",
      to: "neutral",
    });
    expect(effectiveRegisterRange("clarify-only", casualToFormal)).toEqual({
      from: "casual",
      to: "formal",
    });
  });

  it("默认角色卡 casual-neutral 在所有档位下都不超出范围", () => {
    const defaultRange = { from: "casual" as const, to: "neutral" as const };
    expect(effectiveRegisterRange("full-support", defaultRange)).toEqual(defaultRange);
    expect(effectiveRegisterRange("target-only", defaultRange)).toEqual(defaultRange);
  });
});

describe("splitRegisterAnnotations（角色消息语域标注拆分）", () => {
  it("无标记时返回原文与空标注", () => {
    const { text, annotations } = splitRegisterAnnotations("hello there");
    expect(text).toBe("hello there");
    expect(annotations).toEqual([]);
  });

  it("拆分 [[register:<level>]] 标记并给出 clean text 与位置", () => {
    const raw = "hey [[register:casual]]wanna grab coffee[[register:neutral]] later";
    const { text, annotations } = splitRegisterAnnotations(raw);
    expect(text).toBe("hey wanna grab coffee later");
    expect(annotations).toEqual([
      {
        start: 4,
        end: 21,
        register: "casual",
        label: REGISTER_LABELS.casual,
      },
    ]);
  });

  it("支持多个标注段", () => {
    const raw =
      "[[register:casual]]wanna[[register:neutral]] or [[register:formal]]would like[[register:neutral]]?";
    const { text, annotations } = splitRegisterAnnotations(raw);
    expect(text).toBe("wanna or would like?");
    expect(annotations.map((a) => ({ register: a.register, text: text.slice(a.start, a.end) }))).toEqual([
      { register: "casual", text: "wanna" },
      { register: "formal", text: "would like" },
    ]);
  });

  it("尾部的孤立标记不产生空标注", () => {
    const raw = "hello [[register:casual]]";
    const { text, annotations } = splitRegisterAnnotations(raw);
    expect(text).toBe("hello ");
    expect(annotations).toEqual([]);
  });
});

describe("支架档位控制（issue #13，ADR-0015）", () => {
  it("ensureLearnerProfile 以角色卡档位初始化档案", () => {
    const { db, clock } = makeHarness();
    ensureLearnerProfile({ db, clock, language: "en", cardTier: "on-request" });
    const tier = getScaffoldingTier({ db, clock, language: "en" });
    expect(tier).toEqual({ tier: "on-request", source: "manual", temporary: false });
  });

  it("无档案时回退到默认档位", () => {
    const { db, clock } = makeHarness();
    const tier = getScaffoldingTier({ db, clock, language: "en" });
    expect(tier).toEqual({ tier: DEFAULT_SCAFFOLDING_TIER, source: "card", temporary: false });
  });

  it("手动调档即刻生效并记档", () => {
    const { db, clock } = makeHarness();
    setScaffoldingTier({ db, clock, language: "en", tier: "clarify-only" });
    expect(getScaffoldingTier({ db, clock, language: "en" })).toEqual({
      tier: "clarify-only",
      source: "manual",
      temporary: false,
    });
  });

  it("临时档位在有效期内生效，过期后回退", () => {
    const { db, clock } = makeHarness();
    setScaffoldingTier({ db, clock, language: "en", tier: "on-request" });
    setScaffoldingTier({ db, clock, language: "en", tier: "clarify-only", temporary: true });
    expect(getScaffoldingTier({ db, clock, language: "en" }).tier).toBe("clarify-only");

    clock.advance(23 * 60 * 60 * 1000);
    expect(getScaffoldingTier({ db, clock, language: "en" }).tier).toBe("clarify-only");

    clock.advance(2 * 60 * 60 * 1000);
    expect(getScaffoldingTier({ db, clock, language: "en" })).toEqual({
      tier: "on-request",
      source: "manual",
      temporary: false,
    });
  });
});

describe("支架档位建议（issue #13，ADR-0015）", () => {
  function recordProduction(db: ReturnType<typeof makeHarness>["db"], store: ReturnType<typeof makeHarness>["store"], chunkId: string, occurredAt: number) {
    insertChunk(db, chunkId, { createdAt: occurredAt });
    store.recordEvidence({
      observationId: `obs-${chunkId}`,
      chunkId,
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "…",
      occurredAt,
    });
  }

  function recordFailure(db: ReturnType<typeof makeHarness>["db"], store: ReturnType<typeof makeHarness>["store"], chunkId: string, occurredAt: number) {
    insertChunk(db, chunkId, { createdAt: occurredAt });
    store.recordEvidence({
      observationId: `obs-${chunkId}`,
      chunkId,
      assistance: "none",
      outcome: "wrong",
      confidence: 0.95,
      quote: "…",
      occurredAt,
    });
  }

  it("独立产出足够多时建议下调一档", () => {
    const { db, clock, store } = makeHarness();
    ensureLearnerProfile({ db, clock, language: "en", cardTier: "full-support" });
    for (let i = 0; i < 3; i += 1) {
      recordProduction(db, store, `chunk-ok-${i}`, T0 + i * DAY);
    }
    clock.set(T0 + 4 * DAY);
    const suggestion = proposeScaffoldingTier({ db, clock, language: "en" });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.tier).toBe("on-request");
    expect(suggestion!.reason).toContain("独立产出");
    expect(getPendingSuggestion({ db, language: "en" })?.tier).toBe("on-request");
  });

  it("独立失败足够多时建议上调一档", () => {
    const { db, clock, store } = makeHarness();
    setScaffoldingTier({ db, clock, language: "en", tier: "clarify-only" });
    for (let i = 0; i < 2; i += 1) {
      recordFailure(db, store, `chunk-bad-${i}`, T0 + i * DAY);
    }
    clock.set(T0 + 4 * DAY);
    const suggestion = proposeScaffoldingTier({ db, clock, language: "en" });
    expect(suggestion?.tier).toBe("on-request");
  });

  it("待确认建议存在时不再产生新建议", () => {
    const { db, clock, store } = makeHarness();
    ensureLearnerProfile({ db, clock, language: "en", cardTier: "full-support" });
    for (let i = 0; i < 3; i += 1) {
      recordProduction(db, store, `chunk-ok-${i}`, T0 + i * DAY);
    }
    clock.set(T0 + 4 * DAY);
    proposeScaffoldingTier({ db, clock, language: "en" });
    expect(proposeScaffoldingTier({ db, clock, language: "en" })).toBeNull();
  });

  it("确认建议后档位生效并清空待确认", () => {
    const { db, clock, store } = makeHarness();
    ensureLearnerProfile({ db, clock, language: "en", cardTier: "full-support" });
    for (let i = 0; i < 3; i += 1) {
      recordProduction(db, store, `chunk-ok-${i}`, T0 + i * DAY);
    }
    clock.set(T0 + 4 * DAY);
    const suggestion = proposeScaffoldingTier({ db, clock, language: "en" })!;
    acceptScaffoldingSuggestion({ db, clock, language: "en" });
    expect(getScaffoldingTier({ db, clock, language: "en" }).tier).toBe(suggestion.tier);
    expect(getPendingSuggestion({ db, language: "en" })).toBeNull();
  });

  it("拒绝建议不改变档位并进入冷却", () => {
    const { db, clock, store } = makeHarness();
    ensureLearnerProfile({ db, clock, language: "en", cardTier: "full-support" });
    for (let i = 0; i < 3; i += 1) {
      recordProduction(db, store, `chunk-ok-${i}`, T0 + i * DAY);
    }
    clock.set(T0 + 4 * DAY);
    const before = getScaffoldingTier({ db, clock, language: "en" }).tier;
    proposeScaffoldingTier({ db, clock, language: "en" });
    rejectScaffoldingSuggestion({ db, clock, language: "en" });
    expect(getScaffoldingTier({ db, clock, language: "en" }).tier).toBe(before);
    expect(getPendingSuggestion({ db, language: "en" })).toBeNull();
    expect(proposeScaffoldingTier({ db, clock, language: "en" })).toBeNull();
  });

  it("formatScaffoldingSuggestion 包含档位、理由与确认/取消指令", () => {
    const text = formatScaffoldingSuggestion({ tier: "on-request", reason: "test" });
    expect(text).toContain("on-request");
    expect(text).toContain("test");
    expect(text).toContain("确认调档");
    expect(text).toContain("取消");
  });
});
