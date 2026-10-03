import { describe, expect, it } from "vitest";
import { DEFAULT_SCAFFOLDING_TIER, parseScaffoldingTier, scaffoldingPolicy } from "../src/index";

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
