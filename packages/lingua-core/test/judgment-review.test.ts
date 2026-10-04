import { describe, expect, it } from "vitest";
import { DAY, insertChunk, makeHarness, T0 } from "./helpers";

describe("judgment review", () => {
  it("lists sensor judgment records with event type, confidence, quote and chunk reference", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1", { form: "look up" });

    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.85,
      quote: "I looked it up",
      topicId: "topic-1",
      judge: { name: "jev", version: "0.5.0" },
    });

    const records = store.listJudgments();
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.eventType).toBe("independent-production");
    expect(record.confidence).toBe(0.85);
    expect(record.quote).toBe("I looked it up");
    expect(record.chunkId).toBe("chunk-1");
    expect(record.chunkForm).toBe("look up");
    expect(record.judgeName).toBe("jev");
    expect(record.judgeVersion).toBe("0.5.0");
    expect(record.applied).toBe(true);
  });

  it("excludes initial-learning and void events from the judgment list", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");

    store.recordInitialLearning({ observationId: "prelearn-1", chunkId: "chunk-1" });
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "used",
    });
    store.voidObservation({ observationId: "obs-1", chunkId: "chunk-1", reason: "误判" });

    const records = store.listJudgments();
    expect(records).toHaveLength(1);
    expect(records[0]!.eventType).toBe("independent-production");
  });

  it("filters judgment records by language, chunk and observation", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-en", { language: "en" });
    insertChunk(db, "chunk-es", { language: "es" });

    store.recordEvidence({
      observationId: "obs-en",
      chunkId: "chunk-en",
      assistance: "none",
      outcome: "correct",
      confidence: 0.9,
      quote: "ok",
    });
    store.recordEvidence({
      observationId: "obs-es",
      chunkId: "chunk-es",
      assistance: "none",
      outcome: "correct",
      confidence: 0.9,
      quote: "ok",
    });

    expect(store.listJudgments({ language: "en" })).toHaveLength(1);
    expect(store.listJudgments({ language: "en" })[0]!.chunkId).toBe("chunk-en");
    expect(store.listJudgments({ chunkId: "chunk-es" })).toHaveLength(1);
    expect(store.listJudgments({ observationId: "obs-en" })).toHaveLength(1);
  });

  it("returns the evidence chain for each judgment", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");

    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I look up it",
      occurredAt: T0,
    });
    clock.advance(DAY);
    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "wrong",
      confidence: 1,
      quote: "I look up it",
      occurredAt: T0,
      judge: { name: "human-review", version: "1" },
    });

    const records = store.listJudgments();
    expect(records).toHaveLength(2);
    const chain = records[0]!.chain;
    expect(chain).toHaveLength(2);
    expect(chain[0]!.eventType).toBe("independent-attempt-failed");
    expect(chain[1]!.eventType).toBe("independent-production");
    expect(chain[0]!.supersedesEventId).toBe(chain[1]!.eventId);
  });

  it("gets a single judgment record by event id", () => {
    const { db, store } = makeHarness();
    insertChunk(db, "chunk-1");

    const event = store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "wrong",
      confidence: 0.8,
      quote: "wrong",
    });

    const record = store.getJudgment(event.eventId);
    expect(record).toBeDefined();
    expect(record!.eventType).toBe("independent-attempt-failed");
    expect(store.getJudgment("missing")).toBeUndefined();
  });
});

describe("correctObservation", () => {
  it("appends a void and a replacement event, leaving the original row intact", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");

    const original = store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I look up it",
      occurredAt: T0,
    });

    clock.advance(DAY);
    const correction = store.correctObservation({
      observationId: "obs-1",
      chunkId: "chunk-1",
      outcome: "wrong",
      reason: "语序错误",
    });

    expect(correction.voidEvent.eventType).toBe("void");
    expect(correction.voidEvent.voidsEventId).toBe(original.eventId);
    expect(correction.newEvent.eventType).toBe("independent-attempt-failed");
    expect(correction.newEvent.observationId).toBe("obs-1");
    expect(correction.newEvent.occurredAt).toBe(T0);

    const row = db
      .prepare("SELECT outcome, event_type FROM events WHERE event_id = ?")
      .get(original.eventId) as { outcome: string | null; event_type: string };
    expect(row.event_type).toBe("independent-production");
    expect(row.outcome).toBe("correct");
  });

  it("recalculates affected chunk state after a correction without leaking into as-of history", () => {
    const { db, clock, store } = makeHarness();
    insertChunk(db, "chunk-1");

    store.recordEvidence({
      observationId: "obs-1",
      chunkId: "chunk-1",
      assistance: "none",
      outcome: "correct",
      confidence: 0.95,
      quote: "I look up it",
      occurredAt: T0,
    });

    clock.set(T0 + 2 * DAY);
    store.correctObservation({
      observationId: "obs-1",
      chunkId: "chunk-1",
      outcome: "wrong",
      reason: "误判为正确",
    });

    const beforeCorrection = store.asKnownAt(T0 + DAY).chunks.find((c) => c.chunkId === "chunk-1");
    expect(beforeCorrection).toBeDefined();
    expect(beforeCorrection!.lastEventType).toBe("independent-production");
    expect(beforeCorrection!.reps).toBe(1);

    const now = store.currentBeliefAt(T0 + DAY).chunks.find((c) => c.chunkId === "chunk-1");
    expect(now).toBeDefined();
    expect(now!.lastEventType).toBe("independent-attempt-failed");
    expect(now!.reps).toBe(1);
    expect(now!.admittedEvidence).toBe(1);

    const afterCorrection = store.asKnownAt(T0 + 3 * DAY).chunks.find((c) => c.chunkId === "chunk-1");
    expect(afterCorrection).toBeDefined();
    expect(afterCorrection!.lastEventType).toBe("independent-attempt-failed");
  });

  it("rejects correction for an unknown observation", () => {
    const { store } = makeHarness();
    expect(() =>
      store.correctObservation({
        observationId: "nope",
        chunkId: "chunk-1",
        outcome: "wrong",
      }),
    ).toThrow(/nope/);
  });
});
