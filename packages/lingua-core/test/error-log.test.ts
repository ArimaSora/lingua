import { describe, expect, it } from "vitest";
import {
  countTopicErrors,
  listTopicErrors,
  recordErrorLog,
} from "../src/error-log";
import { insertChunk, makeHarness, T0 } from "./helpers";

// 错误日志（issue #8）：语法错误写入独立错误日志，供系统小结与抽检页使用；
// 与学习者状态、关系记忆、prompt 注入之间无直接写入路径。

describe("recordErrorLog", () => {
  it("does not touch learner state: projection and events are unchanged (issue #8)", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1", { form: "look ___ up" });
    store.recordInitialLearning({ observationId: "obs-1", chunkId: "chunk-1" });

    const before = store.currentBeliefAt(clock.now());
    const beforeEventCount = (
      db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }
    ).n;

    recordErrorLog({
      db,
      clock,
      language: "en",
      topicId: "topic-1",
      chunkId: "chunk-1",
      originalText: "I look up it.",
      quote: "look up it",
      phenomenon: "这个表达里有个地方不太对，能发现吗？",
      correction: "正确说法：look it up。",
    });

    const after = store.currentBeliefAt(clock.now());
    expect(after).toEqual(before);
    const afterEventCount = (
      db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }
    ).n;
    expect(afterEventCount).toBe(beforeEventCount);
  });

  it("writes a syntax error with phenomenon and correction", () => {
    const { db, clock } = makeHarness();
    insertChunk(db, "chunk-1", { form: "look ___ up" });

    const entry = recordErrorLog({
      db,
      clock,
      language: "en",
      originalText: "I look up it.",
      quote: "look up it",
      errorType: "usage",
      topicId: "topic-1",
      chunkId: "chunk-1",
      phenomenon: "你用了 look up it，这里有一个词应该放在中间，是哪个位置？",
      correction: "正确说法：look it up（代词放在 look 和 up 之间）。",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.language).toBe("en");
    expect(entry.originalText).toBe("I look up it.");
    expect(entry.quote).toBe("look up it");
    expect(entry.errorType).toBe("usage");
    expect(entry.topicId).toBe("topic-1");
    expect(entry.chunkId).toBe("chunk-1");
    expect(entry.phenomenon).toContain("look up it");
    expect(entry.correction).toContain("look it up");
    expect(entry.createdAt).toBe(T0);

    const row = db
      .prepare("SELECT * FROM error_logs WHERE id = ?")
      .get(entry.id) as {
      original_text: string;
      quote: string;
      chunk_id: string;
      phenomenon: string;
      correction: string;
    };
    expect(row.original_text).toBe("I look up it.");
    expect(row.quote).toBe("look up it");
    expect(row.chunk_id).toBe("chunk-1");
    expect(row.phenomenon).toBeTruthy();
    expect(row.correction).toBeTruthy();
  });

  it("does not require a topic or chunk", () => {
    const { db, clock } = makeHarness();

    const entry = recordErrorLog({
      db,
      clock,
      language: "en",
      originalText: "He go to school.",
      quote: "He go",
      errorType: "grammar",
      phenomenon: "这句话的动词形式有什么问题？",
      correction: "正确说法：He goes to school.",
    });

    expect(entry.topicId).toBeNull();
    expect(entry.chunkId).toBeNull();
  });
});

describe("countTopicErrors / listTopicErrors", () => {
  it("counts and lists errors for a topic", () => {
    const { db, clock } = makeHarness();

    recordErrorLog({
      db,
      clock,
      language: "en",
      originalText: "a",
      topicId: "topic-a",
      phenomenon: "p1",
      correction: "c1",
    });
    recordErrorLog({
      db,
      clock,
      language: "en",
      originalText: "b",
      topicId: "topic-a",
      phenomenon: "p2",
      correction: "c2",
    });
    recordErrorLog({
      db,
      clock,
      language: "en",
      originalText: "c",
      topicId: "topic-b",
      phenomenon: "p3",
      correction: "c3",
    });

    expect(countTopicErrors(db, "topic-a")).toBe(2);
    expect(listTopicErrors(db, "topic-a")).toHaveLength(2);
    expect(countTopicErrors(db, "topic-b")).toBe(1);
    expect(countTopicErrors(db, "missing")).toBe(0);
  });
});
