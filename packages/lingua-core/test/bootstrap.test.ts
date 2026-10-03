import { describe, expect, it } from "vitest";
import {
  FakeClock,
  migrate,
  openBootstrap,
  openChunkStore,
  openDatabase,
  openEventStore,
  openMessageStore,
  parseBootstrapPack,
  renderDigest,
} from "../src/index";
import type { BootstrapPack } from "../src/index";
import { DAY, T0 } from "./helpers";

// Bootstrap 运行时（issue #6）：课包按序推送到系统会话（完成预学才推下一课），
// 推送消息含预学清单与兴趣钩子；预学完成记 initial-learning（不更新掌握度），
// 首次到期 = 预学次日（ADR-0016）。测试接缝：openBootstrap 公开接口 + FakeClock。

function makeBootstrap(start: number = T0) {
  const db = openDatabase(":memory:");
  migrate(db);
  const clock = new FakeClock(start);
  const bootstrap = openBootstrap({ db, clock });
  return { db, clock, bootstrap };
}

function testPack(): BootstrapPack {
  return parseBootstrapPack({
    id: "en-bootstrap-a1",
    language: "en",
    title: "测试课包",
    lessons: [
      {
        id: "en-a1-01-first-contact",
        title: "First contact：打招呼与开场",
        kind: "survival-chunks",
        hook: "和网上的人搭上话，第一句都在这一课。",
        body: "— Hi! How's it going?\n— Pretty good. Nice to meet you!",
        chunks: [
          {
            form: "how's it going",
            chunkType: "idiom",
            cefr: "A2",
            example: "Hey! How's it going?",
            intuition: "熟人寒暄，不是真提问。",
          },
          {
            form: "nice to meet you",
            chunkType: "idiom",
            cefr: "A1",
            example: "I'm Maya. Nice to meet you!",
            intuition: "第一次见面的固定一句。",
          },
        ],
      },
      {
        id: "en-a1-02-rescue",
        title: "日常救场",
        kind: "survival-chunks",
        hook: "卡住时的救生圈。",
        body: "— Excuse me, what do you mean?\n— Never mind.",
        chunks: [
          {
            form: "excuse me",
            chunkType: "idiom",
            cefr: "A1",
            example: "Excuse me, what do you mean?",
            intuition: "打断别人前先垫这一句。",
          },
        ],
      },
    ],
  });
}

describe("seedPack：课包落库", () => {
  it("课与内容条目落库为待推送，重复播种幂等", () => {
    const { db, clock, bootstrap } = makeBootstrap();

    expect(bootstrap.seedPack(testPack()).inserted).toBe(2);
    expect(bootstrap.seedPack(testPack()).inserted).toBe(0);

    const lessons = bootstrap.lessons("en");
    expect(lessons.map((lesson) => lesson.id)).toEqual([
      "en-a1-01-first-contact",
      "en-a1-02-rescue",
    ]);
    expect(lessons.every((lesson) => lesson.status === "pending")).toBe(true);
    expect(lessons.every((lesson) => lesson.packId === "en-bootstrap-a1")).toBe(true);

    // 课即内容源：同 id 的内容条目可被语块扫描引用（故事 12 同一套闭环）——
    // 不存在时 scanContent 会抛 unknown content。
    const chunks = openChunkStore({ db, clock });
    expect(chunks.scanContent("en-a1-01-first-contact").contentId).toBe(
      "en-a1-01-first-contact",
    );

    // 其他语言隔离：未播种的语言没有课。
    expect(bootstrap.lessons("ja")).toEqual([]);
    expect(clock.now()).toBe(T0);
  });
});

describe("pushNextLesson：按序推送到系统会话", () => {
  it("推送第一课：消息含兴趣钩子、预学清单（第一层解释）与正文；语块入调度并落出现记录", () => {
    const { db, clock, bootstrap } = makeBootstrap();
    bootstrap.seedPack(testPack());

    const pushed = bootstrap.pushNextLesson("en");

    expect(pushed).not.toBeNull();
    expect(pushed!.lesson.id).toBe("en-a1-01-first-contact");
    expect(pushed!.lesson.status).toBe("pushed");
    expect(pushed!.chunkIds).toHaveLength(2);

    const messages = openMessageStore({ db, clock }).list({
      language: "en",
      contact: "system",
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("assistant");
    expect(pushed!.message.id).toBe(messages[0]!.id);
    const text = messages[0]!.text;
    expect(text).toContain("和网上的人搭上话"); // 一句「为什么你会感兴趣」钩子
    expect(text).toContain("第 1/2 课");
    expect(text).toContain("[[预学清单]]");
    expect(text).toContain("how's it going");
    expect(text).toContain("Hey! How's it going?"); // 第一层：例句
    expect(text).toContain("熟人寒暄"); // 第一层：一句直觉规律
    expect(text).toContain("Nice to meet you!"); // 课正文
    expect(text).toContain("完成"); // 预学完成指引

    // 语块在课正文中的出现记录落库：课包内容走同一套闭环（故事 12）。
    const occurrences = openChunkStore({ db, clock }).listOccurrences(pushed!.chunkIds[0]!);
    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences[0]!.contentId).toBe("en-a1-01-first-contact");
  });

  it("上一课未完成预学时不推新课（按序，不堆债）", () => {
    const { bootstrap } = makeBootstrap();
    bootstrap.seedPack(testPack());
    bootstrap.pushNextLesson("en");

    expect(bootstrap.pushNextLesson("en")).toBeNull();
    expect(bootstrap.pendingLesson("en")!.id).toBe("en-a1-01-first-contact");
    expect(bootstrap.pendingLesson("en")!.status).toBe("pushed");
  });

  it("未播种的语言无课可推", () => {
    const { bootstrap } = makeBootstrap();
    expect(bootstrap.pushNextLesson("en")).toBeNull();
    expect(bootstrap.pendingLesson("en")).toBeNull();
  });
});

describe("completePreLearning：预学完成闭环（ADR-0016）", () => {
  it("每个语块记 initial-learning：不冒充成功回忆、不更新掌握度", () => {
    const { db, clock, bootstrap } = makeBootstrap();
    bootstrap.seedPack(testPack());
    const pushed = bootstrap.pushNextLesson("en")!;

    const completed = bootstrap.completePreLearning("en")!;

    expect(completed.lesson.id).toBe("en-a1-01-first-contact");
    expect(completed.lesson.status).toBe("prelearned");
    expect(completed.events).toHaveLength(2);
    expect(completed.events.every((event) => event.eventType === "initial-learning")).toBe(true);
    expect(new Set(completed.events.map((event) => event.chunkId))).toEqual(
      new Set(pushed.chunkIds),
    );

    // 不更新掌握度：无评分、无提取证据、PFA 无记录；到期 = 预学次日。
    const store = openEventStore({ db, clock });
    const belief = store.currentBeliefAt(T0);
    for (const chunkId of pushed.chunkIds) {
      const mastery = belief.chunks.find((chunk) => chunk.chunkId === chunkId)!;
      expect(mastery.state).toBe("new");
      expect(mastery.reps).toBe(0);
      expect(mastery.admittedEvidence).toBe(0);
      expect(mastery.lastEventType).toBe("initial-learning");
      expect(mastery.dueAt).toBe(T0 + DAY);
      expect(belief.skills.find((skill) => skill.skillId === chunkId)).toBeUndefined();
    }

    expect(bootstrap.pendingLesson("en")).toBeNull();
    expect(bootstrap.lessons("en")[0]!.status).toBe("prelearned");
  });

  it("假时钟验证：预学次日该语块出现在到期队列", () => {
    const { db, clock, bootstrap } = makeBootstrap();
    bootstrap.seedPack(testPack());
    bootstrap.pushNextLesson("en");
    bootstrap.completePreLearning("en");

    // 预学当天：不到期，digest 无埋伏目标。
    const store = openEventStore({ db, clock });
    expect(renderDigest({ db, clock, language: "en" }).text).not.toContain("埋伏目标");

    clock.advance(DAY + 1); // 预学次日
    const due = store
      .currentBeliefAt(clock.now())
      .chunks.filter((chunk) => chunk.dueAt !== null && chunk.dueAt <= clock.now());
    expect(due).toHaveLength(2);
    const digest = renderDigest({ db, clock, language: "en" });
    expect(digest.text).toContain("埋伏目标");
    expect(digest.text).toContain("how's it going");
    expect(digest.text).toContain("nice to meet you");
  });

  it("重复完成幂等：无待完成课时返回 null，不重复记事件", () => {
    const { db, clock, bootstrap } = makeBootstrap();
    bootstrap.seedPack(testPack());
    bootstrap.pushNextLesson("en");
    bootstrap.completePreLearning("en");

    expect(bootstrap.completePreLearning("en")).toBeNull();
    const events = openEventStore({ db, clock }).currentBeliefAt(T0).chunks;
    expect(events.every((chunk) => chunk.admittedEvidence === 0)).toBe(true);
  });

  it("完成首课后下一课可推送；课包推完即止", () => {
    const { bootstrap } = makeBootstrap();
    bootstrap.seedPack(testPack());
    bootstrap.pushNextLesson("en");
    bootstrap.completePreLearning("en");

    const second = bootstrap.pushNextLesson("en")!;
    expect(second.lesson.id).toBe("en-a1-02-rescue");
    expect(second.message.text).toContain("第 2/2 课");

    bootstrap.completePreLearning("en");
    expect(bootstrap.pushNextLesson("en")).toBeNull();
    expect(bootstrap.lessons("en").every((lesson) => lesson.status === "prelearned")).toBe(true);
  });

  it("无待完成课时完成预学返回 null", () => {
    const { bootstrap } = makeBootstrap();
    bootstrap.seedPack(testPack());
    expect(bootstrap.completePreLearning("en")).toBeNull();
  });
});
