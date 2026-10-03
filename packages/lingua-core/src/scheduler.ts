import type { Clock } from "./clock";
import type { Database } from "./database";

// 唯一调度器（issue #6，mvp.md 修订「调度器单一模块」）：全部周期 tick 收拢
// 于此——Bootstrap 课包推送、定时备份，以及后续票据的 RSS 轮询、起话题检查
// 都以任务注册进来。时钟端口注入：tick() 幂等、假时钟可驱动，壳层只用真
// 定时器戳 tick，不在壳内另建调度逻辑。票 04 的额度入账是查询时惰性结算
// （ADR-0016），本模块不重复实现其 tick。
//
// 任务的 last_run_at 持久化在 scheduler_tasks：运行间隔跨进程重启有效；
// 失败的任务不计 last_run，下一 tick 立即重试。

export type SchedulerTask = {
  id: string;
  // 距上次成功运行的最小间隔（毫秒）；0 = 每个 tick 都运行。
  intervalMs: number;
  run(now: number): void;
};

export type SchedulerOptions = {
  db: Database;
  clock: Clock;
  userId?: string;
  tasks?: SchedulerTask[];
};

export type TaskError = {
  taskId: string;
  message: string;
};

export type TickReport = {
  at: number;
  // 本 tick 实际执行的任务 id（按注册顺序）。
  ran: string[];
  errors: TaskError[];
};

export type Scheduler = {
  tick(): TickReport;
  registerTask(task: SchedulerTask): void;
};

export function openScheduler(options: SchedulerOptions): Scheduler {
  const { db, clock } = options;
  const userId = options.userId ?? "local";

  const tasks = new Map<string, SchedulerTask>();
  function registerTask(task: SchedulerTask): void {
    if (typeof task.id !== "string" || task.id.trim().length === 0) {
      throw new Error("调度任务 id 不能为空");
    }
    if (tasks.has(task.id)) {
      throw new Error(`调度任务 id 重复：${task.id}`);
    }
    if (!Number.isInteger(task.intervalMs) || task.intervalMs < 0) {
      throw new RangeError(`调度任务 ${task.id} 的 intervalMs 必须是 ≥0 的整数毫秒`);
    }
    tasks.set(task.id, task);
  }
  for (const task of options.tasks ?? []) registerTask(task);

  const getLastRun = db.prepare(
    "SELECT last_run_at FROM scheduler_tasks WHERE user_id = ? AND task_id = ?",
  );
  const upsertLastRun = db.prepare(
    `INSERT INTO scheduler_tasks (user_id, task_id, last_run_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, task_id) DO UPDATE SET last_run_at = excluded.last_run_at`,
  );

  function tick(): TickReport {
    const now = clock.now();
    const report: TickReport = { at: now, ran: [], errors: [] };
    for (const task of tasks.values()) {
      const last = getLastRun.get(userId, task.id) as { last_run_at: number } | undefined;
      if (last && now - last.last_run_at < task.intervalMs) continue;
      try {
        task.run(now);
        upsertLastRun.run(userId, task.id, now);
        report.ran.push(task.id);
      } catch (error) {
        report.errors.push({ taskId: task.id, message: (error as Error).message });
      }
    }
    return report;
  }

  return { tick, registerTask };
}
