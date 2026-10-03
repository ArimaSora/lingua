import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FakeClock,
  migrate,
  openBootstrap,
  openDatabase,
  openScheduler,
  parseBootstrapPack,
  runBackup,
} from "../src/index";
import { DAY, HOUR, T0 } from "./helpers";

// 唯一调度器（issue #6）：全部周期 tick 收拢于本模块——课包推送、定时备份
// 与后续票据的周期任务都以任务注册进来；时钟端口注入，假时钟可测。
// 票 04 的额度入账是查询时惰性结算，调度器不重复实现其 tick。

function makeScheduler(start: number = T0) {
  const db = openDatabase(":memory:");
  migrate(db);
  const clock = new FakeClock(start);
  return { db, clock };
}

function tinyPack() {
  return parseBootstrapPack({
    id: "pack",
    language: "en",
    title: "微型课包",
    lessons: ["lesson-1", "lesson-2"].map((id) => ({
      id,
      title: id,
      kind: "survival-chunks",
      hook: `hook of ${id}`,
      body: `body of ${id}. Nice to meet you!`,
      chunks: [
        {
          form: "nice to meet you",
          chunkType: "idiom",
          cefr: "A1",
          example: "Nice to meet you!",
          intuition: "第一次见面的固定一句。",
        },
      ],
    })),
  });
}

describe("tick：任务到期运行", () => {
  it("intervalMs = 0 的任务每个 tick 都运行；报告按注册顺序列出执行者", () => {
    const { db, clock } = makeScheduler();
    const calls: string[] = [];
    const scheduler = openScheduler({
      db,
      clock,
      tasks: [
        { id: "a", intervalMs: 0, run: () => calls.push("a") },
        { id: "b", intervalMs: 0, run: () => calls.push("b") },
      ],
    });

    const report = scheduler.tick();

    expect(report.at).toBe(T0);
    expect(report.ran).toEqual(["a", "b"]);
    expect(report.errors).toEqual([]);
    expect(calls).toEqual(["a", "b"]);
    expect(scheduler.tick().ran).toEqual(["a", "b"]);
  });

  it("间隔门控：首次即运行，间隔内不重复，间隔过后再运行", () => {
    const { db, clock } = makeScheduler();
    let calls = 0;
    const scheduler = openScheduler({
      db,
      clock,
      tasks: [{ id: "hourly", intervalMs: HOUR, run: () => (calls += 1) }],
    });

    expect(scheduler.tick().ran).toEqual(["hourly"]);
    clock.advance(30 * 60 * 1000);
    expect(scheduler.tick().ran).toEqual([]);
    clock.advance(31 * 60 * 1000);
    expect(scheduler.tick().ran).toEqual(["hourly"]);
    expect(calls).toBe(2);
  });

  it("last_run 持久化：调度器重建（进程重启）后间隔仍然有效", () => {
    const { db, clock } = makeScheduler();
    let calls = 0;
    const task = { id: "daily", intervalMs: DAY, run: () => (calls += 1) };
    openScheduler({ db, clock, tasks: [task] }).tick();

    clock.advance(12 * HOUR);
    const reopened = openScheduler({ db, clock, tasks: [task] });
    expect(reopened.tick().ran).toEqual([]);
    expect(calls).toBe(1);
  });

  it("任务失败被收集进报告而不抛出；失败不计 last_run，下一 tick 重试", () => {
    const { db, clock } = makeScheduler();
    let healthy = 0;
    let failOnce = true;
    const scheduler = openScheduler({
      db,
      clock,
      tasks: [
        {
          id: "flaky",
          intervalMs: DAY,
          run: () => {
            if (failOnce) {
              failOnce = false;
              throw new Error("源数据库正被占用");
            }
          },
        },
        { id: "healthy", intervalMs: DAY, run: () => (healthy += 1) },
      ],
    });

    const report = scheduler.tick();

    expect(report.ran).toEqual(["healthy"]);
    expect(report.errors).toEqual([{ taskId: "flaky", message: "源数据库正被占用" }]);
    // 失败任务下一 tick 立即重试；健康任务按间隔节流。
    const retry = scheduler.tick();
    expect(retry.ran).toEqual(["flaky"]);
    expect(retry.errors).toEqual([]);
    expect(healthy).toBe(1);
  });

  it("拒绝非法任务：重复 id、负间隔、空 id", () => {
    const { db, clock } = makeScheduler();
    expect(() =>
      openScheduler({
        db,
        clock,
        tasks: [
          { id: "a", intervalMs: 0, run: () => {} },
          { id: "a", intervalMs: 0, run: () => {} },
        ],
      }),
    ).toThrow(/重复/);
    const scheduler = openScheduler({ db, clock });
    expect(() => scheduler.registerTask({ id: "b", intervalMs: -1, run: () => {} })).toThrow(
      /intervalMs/,
    );
    expect(() => scheduler.registerTask({ id: " ", intervalMs: 0, run: () => {} })).toThrow(
      /id/,
    );
  });
});

describe("调度器驱动课包推送与备份（集成）", () => {
  it("bootstrap-push 任务：tick 驱动课包按序推送，完成预学后推下一课", () => {
    const { db, clock } = makeScheduler();
    const bootstrap = openBootstrap({ db, clock });
    bootstrap.seedPack(tinyPack());
    const scheduler = openScheduler({
      db,
      clock,
      tasks: [
        { id: "bootstrap-push", intervalMs: 0, run: () => void bootstrap.pushNextLesson("en") },
      ],
    });

    scheduler.tick();
    expect(bootstrap.pendingLesson("en")!.id).toBe("lesson-1");

    scheduler.tick(); // 上一课未完成预学：任务照跑但不推新课
    expect(bootstrap.lessons("en").filter((lesson) => lesson.status === "pushed")).toHaveLength(
      1,
    );

    bootstrap.completePreLearning("en");
    scheduler.tick();
    expect(bootstrap.pendingLesson("en")!.id).toBe("lesson-2");
  });

  it("backup 任务：tick 调 runBackup 生成备份文件并按间隔节流", () => {
    const dir = mkdtempSync(join(tmpdir(), "lingua-sched-"));
    const db = openDatabase(join(dir, "lingua.db"));
    try {
      migrate(db);
      const clock = new FakeClock(T0);
      const scheduler = openScheduler({
        db,
        clock,
        tasks: [
          {
            id: "backup",
            intervalMs: DAY,
            run: () => {
              runBackup({
                sourcePath: join(dir, "lingua.db"),
                backupDir: join(dir, "backups"),
                keepLast: 7,
                clock,
              });
            },
          },
        ],
      });

      expect(scheduler.tick().ran).toEqual(["backup"]);
      expect(readdirSync(join(dir, "backups"))).toHaveLength(1);

      expect(scheduler.tick().ran).toEqual([]);
      clock.advance(DAY + 1);
      expect(scheduler.tick().ran).toEqual(["backup"]);
      expect(readdirSync(join(dir, "backups"))).toHaveLength(2);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
  });
});
