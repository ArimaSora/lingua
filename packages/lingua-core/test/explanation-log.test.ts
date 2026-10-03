import { describe, expect, it } from "vitest";
import { openExplanationLog, openMessageStore } from "../src/index";
import { makeHarness, T0 } from "./helpers";

// 讲解投递记录（issue #12）：交付的每条讲解可追溯到知识条目 ID + 证据等级 + 层，
// 随消息持久化（message_id），供「角色眼中的你」式抽检与验收。

function appendAssistantMessage(
  db: Parameters<typeof openMessageStore>[0]["db"],
  clock: Parameters<typeof openMessageStore>[0]["clock"],
  text: string,
): string {
  return openMessageStore({ db, clock }).append({
    language: "en",
    contact: "companion",
    role: "assistant",
    text,
  }).id;
}

describe("openExplanationLog（讲解投递记录，issue #12）", () => {
  it("记录讲解引用并可按消息查回：条目 ID、证据等级、层", () => {
    const { db, clock } = makeHarness();
    const log = openExplanationLog({ db, clock });
    const messageId = appendAssistantMessage(db, clock, "【grammar-past-simple】例：…");

    log.record({
      language: "en",
      messageId,
      entryId: "grammar-past-simple",
      evidenceLevel: "学界共识",
      layer: 1,
    });

    const refs = log.forMessage(messageId);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      language: "en",
      messageId,
      entryId: "grammar-past-simple",
      evidenceLevel: "学界共识",
      layer: 1,
    });
    expect(refs[0]!.createdAt).toBe(T0);
  });

  it("一条消息可挂多条引用（对比讲解），按时间正序返回", () => {
    const { db, clock } = makeHarness();
    const log = openExplanationLog({ db, clock });
    const messageId = appendAssistantMessage(db, clock, "两条对比一下");

    log.record({
      language: "en",
      messageId,
      entryId: "grammar-present-perfect",
      evidenceLevel: "学界共识",
      layer: 1,
    });
    clock.advance(1);
    log.record({
      language: "en",
      messageId,
      entryId: "grammar-past-simple",
      evidenceLevel: "学界共识",
      layer: 2,
    });

    expect(log.forMessage(messageId).map((ref) => ref.entryId)).toEqual([
      "grammar-present-perfect",
      "grammar-past-simple",
    ]);
  });

  it("按消息隔离：别的消息的引用不混入", () => {
    const { db, clock } = makeHarness();
    const log = openExplanationLog({ db, clock });
    const first = appendAssistantMessage(db, clock, "第一条");
    const second = appendAssistantMessage(db, clock, "第二条");

    log.record({
      language: "en",
      messageId: first,
      entryId: "register-requests",
      evidenceLevel: "学界共识",
      layer: 1,
    });

    expect(log.forMessage(second)).toEqual([]);
    expect(log.forMessage(first)).toHaveLength(1);
  });

  it("拒绝非法证据等级与层（数据库 CHECK 兜底）", () => {
    const { db, clock } = makeHarness();
    const log = openExplanationLog({ db, clock });
    const messageId = appendAssistantMessage(db, clock, "消息");

    expect(() =>
      log.record({
        language: "en",
        messageId,
        entryId: "x",
        evidenceLevel: "民科" as never,
        layer: 1,
      }),
    ).toThrow();
    expect(() =>
      log.record({
        language: "en",
        messageId,
        entryId: "x",
        evidenceLevel: "学界共识",
        layer: 4 as never,
      }),
    ).toThrow();
  });
});
