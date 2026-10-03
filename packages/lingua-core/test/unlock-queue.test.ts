import { describe, expect, it } from "vitest";
import { openDatabase, migrate, FakeClock } from "../src/index";
import { openUnlockQueue } from "../src/unlock-queue";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const clock = new FakeClock(1_000_000);
  return { db, clock };
}

function seedContent(db: ReturnType<typeof openDatabase>, params: {
  id: string;
  title: string | null;
  sourceUrl: string | null;
  perishability: "perishable" | "evergreen";
  unlockLevel?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  expiresAt?: number | null;
  createdAt?: number;
}) {
  db.prepare(
    `INSERT INTO content_items (
       id, user_id, language, feed_id, source_url, title, body,
       difficulty_score, cefr_estimate, perishability, unlock_level,
       status, pipeline_status, expires_at, simplified_source_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.id,
    "local",
    "en",
    null,
    params.sourceUrl,
    params.title,
    "body",
    0.5,
    params.unlockLevel ?? "B1",
    params.perishability,
    params.unlockLevel ?? "B1",
    "inbox",
    "unlock_queued",
    params.expiresAt ?? null,
    null,
    params.createdAt ?? 1_000_000,
  );
}

describe("解锁队列", () => {
  it("add 把内容标记为 unlock_queued", () => {
    const { db, clock } = setup();
    seedContent(db, { id: "c1", title: "A", sourceUrl: "https://a", perishability: "evergreen" });
    const queue = openUnlockQueue({ db, clock, language: "en" });
    queue.add("c1", { unlockLevel: "B2" });

    const items = queue.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.contentId).toBe("c1");
    expect(items[0]!.unlockLevel).toBe("B2");
    expect(items[0]!.unlockLabel).toBe("原文难度约 B2");
  });

  it("expireOld 只删除已过期的易腐条目", () => {
    const { db, clock } = setup();
    seedContent(db, {
      id: "old",
      title: "old",
      sourceUrl: "https://old",
      perishability: "perishable",
      expiresAt: clock.now() - 1,
    });
    seedContent(db, {
      id: "fresh",
      title: "fresh",
      sourceUrl: "https://fresh",
      perishability: "perishable",
      expiresAt: clock.now() + 24 * 60 * 60 * 1000,
    });
    seedContent(db, {
      id: "ever",
      title: "ever",
      sourceUrl: "https://ever",
      perishability: "evergreen",
      expiresAt: null,
    });

    const queue = openUnlockQueue({ db, clock, language: "en" });
    const removed = queue.expireOld();
    expect(removed).toEqual(["old"]);
    expect(queue.list().map((i) => i.contentId).sort()).toEqual(["ever", "fresh"]);
  });
});
