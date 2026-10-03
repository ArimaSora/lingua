import { describe, expect, it } from "vitest";
import {
  loadKnowledgeEntries,
  openKnowledgeStore,
  parseKnowledgeEntries,
  renderExplanation,
  type KnowledgeEntry,
} from "../src/index";

// 知识条目（issue #12）：讲解的唯一合法来源（ADR-0005），
// 三层呈现默认只给第一层，深挖由用户显式触发。

function fixture(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "grammar-fixture",
    language: "en",
    category: "高频语法",
    title: "夹具条目",
    layers: {
      intuition: { example: "I saw him yesterday.", rule: "动词要带时间。" },
      expansion: "展开：规律细化与对比。",
      terminology: "术语：时态（tense）。",
    },
    evidenceLevel: "学界共识",
    sources: ["WALS Ch.66"],
    ...overrides,
  };
}

describe("parseKnowledgeEntries（条目校验）", () => {
  it("接受合法条目列表", () => {
    const entries = parseKnowledgeEntries([fixture()]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("grammar-fixture");
  });

  it("拒绝非法类别并指明条目位置", () => {
    expect(() =>
      parseKnowledgeEntries([fixture({ category: "冷门语法" as KnowledgeEntry["category"] })]),
    ).toThrow(/grammar-fixture.*类别/);
  });

  it("拒绝非法证据等级", () => {
    expect(() =>
      parseKnowledgeEntries([
        fixture({ evidenceLevel: "民科暴论" as KnowledgeEntry["evidenceLevel"] }),
      ]),
    ).toThrow(/grammar-fixture.*证据等级/);
  });

  it("三层内容缺一不可", () => {
    expect(() =>
      parseKnowledgeEntries([
        fixture({
          layers: {
            intuition: { example: "", rule: "规律" },
            expansion: "展开",
            terminology: "术语",
          },
        }),
      ]),
    ).toThrow(/grammar-fixture/);
    expect(() =>
      parseKnowledgeEntries([
        fixture({
          layers: {
            intuition: { example: "例", rule: "规律" },
            expansion: "",
            terminology: "术语",
          },
        }),
      ]),
    ).toThrow(/grammar-fixture/);
  });

  it("拒绝非 slug 形式的 id", () => {
    expect(() => parseKnowledgeEntries([fixture({ id: "Grammar Entry!" })])).toThrow(
      /Grammar Entry!/,
    );
  });

  it("拒绝重复 id", () => {
    expect(() => parseKnowledgeEntries([fixture(), fixture()])).toThrow(/重复.*grammar-fixture/);
  });

  it("拒绝空来源列表", () => {
    expect(() => parseKnowledgeEntries([fixture({ sources: [] })])).toThrow(
      /grammar-fixture.*来源/,
    );
  });
});

describe("openKnowledgeStore（按 id 查找与按类别列出）", () => {
  const store = openKnowledgeStore({
    entries: parseKnowledgeEntries([
      fixture({ id: "mindset-a", category: "中英思维差异", language: "en" }),
      fixture({ id: "grammar-a", category: "高频语法", language: "en" }),
      fixture({ id: "grammar-b", category: "高频语法", language: "en", title: "另一条语法" }),
      fixture({ id: "register-ja", category: "语用语域", language: "ja" }),
    ]),
  });

  it("按 id 取条目，未知 id 返回 null", () => {
    expect(store.get("grammar-a")?.title).toBe("夹具条目");
    expect(store.get("no-such-entry")).toBeNull();
  });

  it("按类别列出，可按语言过滤", () => {
    expect(store.listByCategory("高频语法").map((entry) => entry.id)).toEqual([
      "grammar-a",
      "grammar-b",
    ]);
    expect(store.listByCategory("语用语域", { language: "en" })).toEqual([]);
    expect(store.listByCategory("语用语域", { language: "ja" })).toHaveLength(1);
  });

  it("目录视图供 prompt 注入：id + 标题 + 类别，稳定排序", () => {
    expect(store.catalog({ language: "en" })).toEqual([
      { id: "mindset-a", title: "夹具条目", category: "中英思维差异" },
      { id: "grammar-a", title: "夹具条目", category: "高频语法" },
      { id: "grammar-b", title: "另一条语法", category: "高频语法" },
    ]);
  });
});

describe("renderExplanation（三层渲染规则，ADR-0005）", () => {
  const entry = fixture({
    id: "grammar-render",
    title: "渲染夹具",
    evidenceLevel: "教学性概括",
  });

  it("默认只渲染第一层：例句 + 一句直觉规律", () => {
    const text = renderExplanation(entry);
    expect(text).toContain("I saw him yesterday.");
    expect(text).toContain("动词要带时间。");
    expect(text).not.toContain("规律细化与对比");
    expect(text).not.toContain("时态（tense）");
  });

  it("渲染始终携带条目 ID 与证据等级（讲解可追溯）", () => {
    const text = renderExplanation(entry);
    expect(text).toContain("grammar-render");
    expect(text).toContain("教学性概括");
  });

  it("显式请求第二层：第一层 + 展开，仍无术语", () => {
    const text = renderExplanation(entry, { layer: 2 });
    expect(text).toContain("动词要带时间。");
    expect(text).toContain("规律细化与对比");
    expect(text).not.toContain("时态（tense）");
  });

  it("显式请求第三层：三层全量", () => {
    const text = renderExplanation(entry, { layer: 3 });
    expect(text).toContain("动词要带时间。");
    expect(text).toContain("规律细化与对比");
    expect(text).toContain("时态（tense）");
  });
});

describe("种子条目库（30 条手工种子，issue #12）", () => {
  const entries = loadKnowledgeEntries();

  it("随包加载默认数据文件并通过校验", () => {
    expect(entries).toHaveLength(30);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(30);
  });

  it("三类各 10 条", () => {
    for (const category of ["中英思维差异", "高频语法", "语用语域"] as const) {
      expect(
        entries.filter((entry) => entry.category === category),
        category,
      ).toHaveLength(10);
    }
  });

  it("「形合/意合」类表述一律标注为教学性概括", () => {
    const related = entries.filter((entry) =>
      [entry.title, entry.layers.intuition.rule, entry.layers.expansion, entry.layers.terminology]
        .join("\n")
        .match(/形合|意合/),
    );
    expect(related.length).toBeGreaterThan(0);
    for (const entry of related) {
      expect(entry.evidenceLevel, entry.id).toBe("教学性概括");
    }
  });

  it("三种证据等级都在使用中（含至少一条有争议条目）", () => {
    const levels = new Set(entries.map((entry) => entry.evidenceLevel));
    expect(levels).toEqual(new Set(["学界共识", "教学性概括", "有争议"]));
  });
});
