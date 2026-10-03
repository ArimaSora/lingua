import { describe, expect, it } from "vitest";
import { openDatabase, migrate, FakeClock } from "../src/index";
import { openContentPipeline, type ContentExtractor, type ContentSimplifier } from "../src/content-pipeline";
import type { Cefr } from "../src/bootstrap-pack";
import type { Wordlist } from "../src/difficulty";

const WORDS: Record<string, Cefr> = {
  the: "A1", cat: "A1", dog: "A1", fish: "A1", bird: "A1",
  be: "A1", big: "A1", small: "A1", good: "A1",
  red: "A1", blue: "A1", and: "A1", i: "A1", like: "A1",
  village: "A2", river: "A2",
  however: "B1", government: "B1", increase: "B1",
  substantial: "B2",
  ubiquitous: "C1",
};

function fakeWordlist(entries: Record<string, Cefr> = WORDS): Wordlist {
  return { lookup: (lemma) => entries[lemma] ?? null };
}

function createExtractor(body: string, publishedAt?: number): ContentExtractor {
  return async () => ({ title: "Sample", body, publishedAt: publishedAt ?? undefined });
}

function createSimplifier(prefix = "简化版"): ContentSimplifier {
  return async ({ body }) => ({ title: `${prefix}: simplified`, body: `${prefix}: ${body}` });
}

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const clock = new FakeClock(1_000_000);
  return { db, clock };
}

describe("内容管道：链接 → 抓取 → 难度评估 → 分流", () => {
  it("固定文本的难度级与覆盖率经管道后仍可复现", async () => {
    const { db, clock } = setup();
    const body = "The cat is big. The dog is small. I like the cat.";
    const pipeline = openContentPipeline({
      db,
      clock,
      language: "en",
      extractor: createExtractor(body),
      simplifier: createSimplifier(),
      wordlist: fakeWordlist(),
    });

    const first = await pipeline.ingest({ url: "https://example.com/essay" });
    const second = await pipeline.ingest({ url: "https://example.com/essay" });
    expect(second.level).toBe(first.level);
    expect(second.coverage).toBe(first.coverage);
    expect(first.level).toBe("A1");
    expect(first.coverage).toBe(1);
    expect(first.perishability).toBe("evergreen");
    expect(first.kind).toBe("direct");
  });

  it("易腐 + 太难 → 生成简化版，不进解锁队列", async () => {
    const { db, clock } = setup();
    const body = "Government increase substantial however ubiquitous.";
    const pipeline = openContentPipeline({
      db,
      clock,
      language: "en",
      extractor: createExtractor(body),
      simplifier: createSimplifier("简化版"),
      wordlist: fakeWordlist(),
    });

    const result = await pipeline.ingest({ url: "https://news.example.com/2026/10/03/agent-release" });
    expect(result.kind).toBe("simplified");
    expect(result.level).toBe("C1");
    expect(result.perishability).toBe("perishable");
    expect(result.simplified).toBeDefined();
    expect(result.simplified!.title).toMatch(/简化版/);
    expect(result.simplified!.body).toMatch(/简化版/);

    const queue = pipeline.listUnlockQueue();
    expect(queue).toHaveLength(0);
  });

  it("常青 + 太难 → 进解锁队列，标签为「原文难度约 X」", async () => {
    const { db, clock } = setup();
    const body = "Government increase substantial however ubiquitous.";
    const pipeline = openContentPipeline({
      db,
      clock,
      language: "en",
      extractor: createExtractor(body),
      simplifier: createSimplifier(),
      wordlist: fakeWordlist(),
    });

    const result = await pipeline.ingest({ url: "https://example.com/essays/attention" });
    expect(result.kind).toBe("unlock_queued");
    expect(result.level).toBe("C1");
    expect(result.perishability).toBe("evergreen");
    expect(result.unlockLabel).toBe("原文难度约 C1");

    const queue = pipeline.listUnlockQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.unlockLabel).toBe("原文难度约 C1");
  });

  it("简化器失败时易腐难文降级为进解锁队列并设过期", async () => {
    const { db, clock } = setup();
    const body = "Government increase substantial however ubiquitous.";
    const pipeline = openContentPipeline({
      db,
      clock,
      language: "en",
      extractor: createExtractor(body),
      simplifier: async () => {
        throw new Error("model unavailable");
      },
      wordlist: fakeWordlist(),
    });

    const result = await pipeline.ingest({ url: "https://news.example.com/2026/10/03/agent-release" });
    expect(result.kind).toBe("unlock_queued");
    expect(result.perishability).toBe("perishable");

    const queue = pipeline.listUnlockQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.expiresAt).toBeGreaterThan(clock.now());
  });

  it("过期清理只删 unlock queue 中超时的易腐条目", async () => {
    const { db, clock } = setup();
    const body = "Government increase substantial however ubiquitous.";
    const pipeline = openContentPipeline({
      db,
      clock,
      language: "en",
      extractor: createExtractor(body),
      simplifier: async () => {
        throw new Error("model unavailable");
      },
      wordlist: fakeWordlist(),
    });

    await pipeline.ingest({ url: "https://news.example.com/2026/10/03/agent-release" });
    expect(pipeline.listUnlockQueue()).toHaveLength(1);

    clock.advance(8 * 24 * 60 * 60 * 1000); // 8 天后
    const removed = pipeline.expireUnlockQueue();
    expect(removed.length).toBe(1);
    expect(pipeline.listUnlockQueue()).toHaveLength(0);
  });
});
