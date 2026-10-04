import { describe, expect, it } from "vitest";
import { openMessageStore } from "../src/index";
import { makeHarness, T0 } from "./helpers";

describe("openMessageStore（双联系人消息持久化，issue #5）", () => {
  it("追加并按时间正序读回，翻译字段随消息持久化", () => {
    const { db, clock } = makeHarness();
    const store = openMessageStore({ db, clock });

    store.append({ language: "en", contact: "companion", role: "user", text: "hi Maya!" });
    clock.advance(1000);
    store.append({
      language: "en",
      contact: "companion",
      role: "assistant",
      text: "hey! long time no see",
      translation: "嘿！好久不见",
    });

    const messages = store.list({ language: "en", contact: "companion" });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", text: "hi Maya!", translation: null });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      text: "hey! long time no see",
      translation: "嘿！好久不见",
    });
    expect(messages[0]!.createdAt).toBe(T0);
    expect(messages[1]!.createdAt).toBe(T0 + 1000);
  });

  it("按联系人与语言隔离：系统会话与其它语言不混入", () => {
    const { db, clock } = makeHarness();
    const store = openMessageStore({ db, clock });

    store.append({ language: "en", contact: "companion", role: "user", text: "hi" });
    store.append({ language: "en", contact: "system", role: "assistant", text: "系统已上线" });
    store.append({ language: "ja", contact: "companion", role: "user", text: "こんにちは" });

    expect(store.list({ language: "en", contact: "companion" })).toHaveLength(1);
    expect(store.list({ language: "en", contact: "system" })).toHaveLength(1);
    expect(store.list({ language: "ja", contact: "companion" })).toHaveLength(1);
    expect(store.list({ language: "ja", contact: "system" })).toHaveLength(0);
  });

  it("limit 取最近 N 条，仍按时间正序返回", () => {
    const { db, clock } = makeHarness();
    const store = openMessageStore({ db, clock });
    for (let i = 0; i < 5; i += 1) {
      store.append({ language: "en", contact: "companion", role: "user", text: `msg ${i}` });
      clock.advance(1);
    }

    const recent = store.list({ language: "en", contact: "companion", limit: 2 });
    expect(recent.map((message) => message.text)).toEqual(["msg 3", "msg 4"]);
  });
});

describe("redact：改写已存消息文本（运行时密钥脱敏）", () => {
  it("改写字幕后读回为新文本；未知消息 id 抛错", () => {
    const { db, clock } = makeHarness();
    const store = openMessageStore({ db, clock });
    const message = store.append({
      language: "en",
      contact: "system",
      role: "user",
      text: "设置密钥 sk-secret-123",
    });

    store.redact(message.id, "设置密钥 ********");
    const listed = store.list({ language: "en", contact: "system" });
    expect(listed[0]!.text).toBe("设置密钥 ********");
    expect(JSON.stringify(listed)).not.toContain("sk-secret-123");

    expect(() => store.redact("no-such-id", "x")).toThrow(/unknown message/);
  });
});
