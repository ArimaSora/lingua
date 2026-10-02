import { describe, expect, it } from "vitest";
import { openChunkStore } from "../src/index";
import { insertContent, makeHarness } from "./helpers";

describe("registerChunk: 语块身份归一", () => {
  it("unifies look it up with look up via the slot pattern", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });

    const canonical = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
      slotPattern: "look ___ up",
    });
    const split = chunks.registerChunk({
      form: "look it up",
      chunkType: "collocation",
      language: "en",
    });

    expect(split.id).toBe(canonical.id);
    expect(split.variants).toContain("look it up");
  });

  it("unifies in either registration order, adopting the slot pattern", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });

    const split = chunks.registerChunk({
      form: "look it up",
      chunkType: "collocation",
      language: "en",
    });
    const canonical = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
      slotPattern: "look ___ up",
    });

    expect(canonical.id).toBe(split.id);
    expect(canonical.slotPattern).toBe("look ___ up");
  });

  it("unifies inflected surface forms (case + tense)", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });

    const canonical = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
      slotPattern: "look ___ up",
    });
    const inflected = chunks.registerChunk({
      form: "Looked the word up",
      chunkType: "collocation",
      language: "en",
    });

    expect(inflected.id).toBe(canonical.id);
  });

  it("creates a distinct identity for a genuinely different chunk", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });

    const a = chunks.registerChunk({ form: "look up", chunkType: "collocation", language: "en" });
    const b = chunks.registerChunk({ form: "give up", chunkType: "idiom", language: "en" });

    expect(b.id).not.toBe(a.id);
  });

  it("rejects types outside v1 (collocation | idiom) with a clear error", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });

    expect(() =>
      chunks.registerChunk({ form: "the more X the more Y", chunkType: "sentence-frame", language: "en" }),
    ).toThrow(/sentence-frame/);
  });
});

describe("scanContent: 出现记录与语块实体分离", () => {
  function registerLookUp(chunks: ReturnType<typeof openChunkStore>) {
    return chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
      slotPattern: "look ___ up",
      status: "enrolled",
    });
  }

  it("locates occurrences in content and persists them with token intervals", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });
    const lookUp = registerLookUp(chunks);
    insertContent(db, "content-1", { body: "I looked the word up yesterday." });

    const scan = chunks.scanContent("content-1");

    // I / looked / the / word / up / yesterday
    expect(scan.occurrences).toHaveLength(1);
    expect(scan.occurrences[0]).toMatchObject({
      chunkId: lookUp.id,
      contentId: "content-1",
      startToken: 1,
      endToken: 5,
      surface: "looked the word up",
      matchedForm: "look ___ up",
    });
    expect(chunks.listOccurrences(lookUp.id)).toHaveLength(1);
  });

  it("shares one identity across articles: both articles point at the same chunk", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });
    const lookUp = registerLookUp(chunks);
    insertContent(db, "content-1", { body: "I looked the word up yesterday." });
    insertContent(db, "content-2", { body: "We will look it up tomorrow." });

    chunks.scanContent("content-1");
    chunks.scanContent("content-2");

    const occurrences = chunks.listOccurrences(lookUp.id);
    expect(occurrences).toHaveLength(2);
    expect(new Set(occurrences.map((o) => o.chunkId)).size).toBe(1);
    expect(new Set(occurrences.map((o) => o.contentId))).toEqual(
      new Set(["content-1", "content-2"]),
    );
    expect(occurrences.map((o) => o.surface).sort()).toEqual([
      "look it up",
      "looked the word up",
    ]);
  });

  it("re-scanning the same content replaces occurrences instead of duplicating them", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });
    const lookUp = registerLookUp(chunks);
    insertContent(db, "content-1", { body: "Look it up. Look it up again." });

    chunks.scanContent("content-1");
    const rescan = chunks.scanContent("content-1");

    expect(rescan.occurrences).toHaveLength(2);
    expect(chunks.listOccurrences(lookUp.id)).toHaveLength(2);
  });

  it("reports not-found chunks without recording anything", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });
    const lookUp = registerLookUp(chunks);
    insertContent(db, "content-1", { body: "Nothing relevant here." });

    const scan = chunks.scanContent("content-1");

    expect(scan.occurrences).toHaveLength(0);
    expect(scan.scans).toEqual([{ chunkId: lookUp.id, status: "not-found" }]);
    expect(chunks.listOccurrences(lookUp.id)).toHaveLength(0);
  });

  it("rejects scanning unknown content", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });

    expect(() => chunks.scanContent("missing")).toThrow(/missing/);
  });
});

describe("出现记录接入记忆：同一身份不拆散", () => {
  it("evidence quoting either article aggregates onto one memory record", () => {
    const { db, clock, store } = makeHarness();
    const chunks = openChunkStore({ db, clock });
    const lookUp = chunks.registerChunk({
      form: "look up",
      chunkType: "collocation",
      language: "en",
      slotPattern: "look ___ up",
      status: "enrolled",
    });
    insertContent(db, "content-1", { body: "I looked the word up yesterday." });
    insertContent(db, "content-2", { body: "We will look it up tomorrow." });
    const surfaces = ["content-1", "content-2"].map(
      (id) => chunks.scanContent(id).occurrences.map((o) => ({ contentId: id, surface: o.surface })),
    );

    // 两次独立产出，quote 分别来自两篇文章的出现记录。
    surfaces.flat().forEach(({ surface }, index) => {
      store.recordEvidence({
        observationId: `obs-${index}`,
        chunkId: lookUp.id,
        assistance: "none",
        outcome: "correct",
        confidence: 0.95,
        quote: surface,
      });
      clock.advance(3 * 24 * 60 * 60 * 1000);
    });

    const projection = store.currentBeliefAt(Date.UTC(2026, 2, 1));
    const mastery = projection.chunks.filter((c) => c.chunkId === lookUp.id);
    expect(mastery).toHaveLength(1);
    expect(mastery[0]!.reps).toBe(2);
    expect(mastery[0]!.admittedEvidence).toBe(2);
  });
});

describe("registerChunk: 类型是身份的一部分", () => {
  it("does not unify the same surface form across different chunk types", () => {
    const { db, clock } = makeHarness();
    const chunks = openChunkStore({ db, clock });

    const collocation = chunks.registerChunk({
      form: "break down",
      chunkType: "collocation",
      language: "en",
    });
    const idiom = chunks.registerChunk({
      form: "break down",
      chunkType: "idiom",
      language: "en",
    });

    expect(idiom.id).not.toBe(collocation.id);
  });
});
