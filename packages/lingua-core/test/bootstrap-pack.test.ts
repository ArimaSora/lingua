import { describe, expect, it } from "vitest";
import { parseBootstrapPack } from "../src/index";

// Bootstrap 课包内容格式（issue #6）：课 = 内容源（高频生存语块 / 基础句构 /
// A1 分级短文），每课带兴趣钩子与预学清单（第一层解释：例句 + 一句直觉规律）。

function validPack(): Record<string, unknown> {
  return {
    id: "en-bootstrap-a1",
    language: "en",
    title: "英语零基础 Bootstrap 课包",
    lessons: [
      {
        id: "en-a1-01-first-contact",
        title: "First contact：打招呼与开场",
        kind: "survival-chunks",
        hook: "和网上的人搭上话，第一句都在这一课。",
        body: "Hi! How's it going? ...",
        chunks: [
          {
            form: "how's it going",
            chunkType: "idiom",
            cefr: "A2",
            example: "Hey! How's it going?",
            intuition: "熟人寒暄，不是真提问——回一句 “pretty good, you?” 就完成社交任务。",
          },
          {
            form: "look for",
            chunkType: "collocation",
            cefr: "A2",
            slotPattern: "look for ___",
            variants: ["looking for"],
            example: "I'm looking for a good post to read.",
            intuition: "“找”这个动作挂在 look for 后面，for 不可丢。",
          },
        ],
      },
      {
        id: "en-a1-02-rescue",
        title: "日常救场",
        kind: "survival-chunks",
        hook: "卡住时的五句救生圈。",
        body: "Excuse me ...",
        chunks: [
          {
            form: "excuse me",
            chunkType: "idiom",
            cefr: "A1",
            example: "Excuse me, what do you mean?",
            intuition: "打断别人前先垫这一句，不算失礼。",
          },
        ],
      },
    ],
  };
}

describe("Bootstrap 课包格式", () => {
  it("解析合法课包：字段保留，槽位与变体规范化", () => {
    const pack = parseBootstrapPack(validPack());

    expect(pack.id).toBe("en-bootstrap-a1");
    expect(pack.language).toBe("en");
    expect(pack.title).toBe("英语零基础 Bootstrap 课包");
    expect(pack.lessons).toHaveLength(2);
    expect(pack.lessons[0]!.kind).toBe("survival-chunks");
    expect(pack.lessons[0]!.chunks[0]!.form).toBe("how's it going");
    expect(pack.lessons[0]!.chunks[0]!.variants).toEqual([]);
    expect(pack.lessons[0]!.chunks[0]!.slotPattern).toBeNull();
    expect(pack.lessons[0]!.chunks[1]!.slotPattern).toBe("look for ___");
    expect(pack.lessons[0]!.chunks[1]!.variants).toEqual(["looking for"]);
  });

  it("拒绝非对象、缺字段与空课列表", () => {
    expect(() => parseBootstrapPack(null)).toThrow(/课包/);
    expect(() => parseBootstrapPack("pack")).toThrow(/课包/);
    expect(() => parseBootstrapPack({ language: "en", lessons: [{}] })).toThrow(/id/);
    expect(() => parseBootstrapPack({ ...validPack(), lessons: [] })).toThrow(/至少一课/);
    const noLanguage = validPack();
    delete noLanguage.language;
    expect(() => parseBootstrapPack(noLanguage)).toThrow(/language/);
  });

  it("拒绝未知课型与坏语块：v1 仅搭配与惯用语，CEFR 六档", () => {
    const badKind = validPack();
    (badKind.lessons as { kind: string }[])[0]!.kind = "grammar";
    expect(() => parseBootstrapPack(badKind)).toThrow(/kind/);

    const badType = validPack();
    (badType.lessons as { chunks: { chunkType: string }[] }[])[0]!.chunks[0]!.chunkType =
      "sentence-pattern";
    expect(() => parseBootstrapPack(badType)).toThrow(/collocation/);

    const badCefr = validPack();
    (badCefr.lessons as { chunks: { cefr: string }[] }[])[0]!.chunks[0]!.cefr = "D1";
    expect(() => parseBootstrapPack(badCefr)).toThrow(/CEFR/);
  });

  it("拒绝空预学清单、空形式、缺第一层解释", () => {
    const noChunks = validPack();
    (noChunks.lessons as { chunks: unknown[] }[])[0]!.chunks = [];
    expect(() => parseBootstrapPack(noChunks)).toThrow(/预学清单/);

    const emptyForm = validPack();
    (emptyForm.lessons as { chunks: { form: string }[] }[])[0]!.chunks[0]!.form = "  ";
    expect(() => parseBootstrapPack(emptyForm)).toThrow(/形式/);

    const noExample = validPack();
    delete (noExample.lessons as { chunks: Record<string, unknown>[] }[])[0]!.chunks[0]!.example;
    expect(() => parseBootstrapPack(noExample)).toThrow(/例句/);

    const noIntuition = validPack();
    delete (noIntuition.lessons as { chunks: Record<string, unknown>[] }[])[0]!.chunks[0]!
      .intuition;
    expect(() => parseBootstrapPack(noIntuition)).toThrow(/直觉规律/);
  });

  it("拒绝重复课 id", () => {
    const dup = validPack();
    const lessons = dup.lessons as Record<string, unknown>[];
    lessons.push({ ...lessons[0]! });
    expect(() => parseBootstrapPack(dup)).toThrow(/重复/);
  });
});
