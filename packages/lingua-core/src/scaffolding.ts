// 母语支架档位（ADR-0004/0015）：用户可控，不随 CEFR 自动渐退。
// 四档行为定义见 docs/specs/mvp.md「双语与语域」：
// A1–A2 救场无限制 + 角色消息附可展开中文翻译；B1 仅明确求助时救场；
// B2 澄清请求代替救场；C1+ 全目标语。档位名按行为命名，不复用 CEFR 标签
// （ADR-0015 三旋钮分离：支架档位不跟随 CEFR）。

export const SCAFFOLDING_TIERS = [
  "full-support",
  "on-request",
  "clarify-only",
  "target-only",
] as const;

export type ScaffoldingTier = (typeof SCAFFOLDING_TIERS)[number];

// 零基础起点，不做入学定级（docs/specs/mvp.md 用户故事 13）。
export const DEFAULT_SCAFFOLDING_TIER: ScaffoldingTier = "full-support";

export function parseScaffoldingTier(value: unknown): ScaffoldingTier {
  if (typeof value === "string" && (SCAFFOLDING_TIERS as readonly string[]).includes(value)) {
    return value as ScaffoldingTier;
  }
  throw new Error(`未知母语支架档位：${String(value)}（可选：${SCAFFOLDING_TIERS.join(" / ")}）`);
}

export type L1Rescue = "unrestricted" | "explicit-request" | "clarify-only" | "none";

// 壳层按此策略装配：是否要求角色消息附中文翻译（渲染为可展开折叠）、
// 系统提示中如何约束角色的母语救场行为。
export type ScaffoldingPolicy = {
  attachL1Translation: boolean;
  l1Rescue: L1Rescue;
};

export function scaffoldingPolicy(tier: ScaffoldingTier): ScaffoldingPolicy {
  switch (tier) {
    case "full-support":
      return { attachL1Translation: true, l1Rescue: "unrestricted" };
    case "on-request":
      return { attachL1Translation: false, l1Rescue: "explicit-request" };
    case "clarify-only":
      return { attachL1Translation: false, l1Rescue: "clarify-only" };
    case "target-only":
      return { attachL1Translation: false, l1Rescue: "none" };
  }
}
