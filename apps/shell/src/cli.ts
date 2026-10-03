import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  checkConfigPermissions,
  migrate,
  openDatabase,
  restoreBackup,
  runBackup,
  SCHEMA_VERSION,
  SystemClock,
} from "@lingua/core";
import { dataDir } from "./data-dir";
import { findConfigPath } from "./config";
import { DEFAULT_PORT, startServer } from "./server";

// 新建配置文件的模板；完整示例见仓库根目录 config.example.toml。
// 密钥永不回显：任何配置展示须经 @lingua/core 的 redactConfig 脱敏。
const CONFIG_TEMPLATE = `# Lingua 配置（由 lingua init 生成；完整示例见仓库 config.example.toml）。
# 本文件含密钥：权限应为 0600，永不入库、永不出现在日志与界面输出中。

[models.main]
provider = "deepseek"
model = "deepseek-chat"
api_key = ""
base_url = "https://api.deepseek.com/v1"
`;

function usage(): never {
  console.error(`usage: lingua <command>

commands:
  init                   初始化数据目录、SQLite schema 与配置文件
  serve [--port N]       启动 Web Chat（默认端口 ${DEFAULT_PORT}）
  backup [--keep N]      备份数据库（默认保留最近 7 份）
  restore <备份> <目标>  从备份恢复到新位置（目标必须不存在）`);
  process.exit(1);
}

// 定时备份由票 06 的唯一调度器驱动（serve 时每日一次，直接调用 @lingua/core
// 的 runBackup，sourcePath/backupDir 取数据目录，keepLast 同为 7）；
// 本 backup 子命令只是同一入口的手工触发器，壳内不另建调度逻辑。
const DEFAULT_KEEP_LAST = 7;

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "init": {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "lingua.db");
    const db = openDatabase(dbPath);
    migrate(db);
    db.close();
    console.log(`lingua 数据目录：${dir}`);
    console.log(`数据库已就绪：${dbPath}（schema v${SCHEMA_VERSION}）`);

    const configPath = join(dir, "config.toml");
    if (!existsSync(configPath)) {
      // mode 仅在新建时生效；Windows 无 POSIX 权限位，见其下的检查结果说明。
      writeFileSync(configPath, CONFIG_TEMPLATE, { mode: 0o600 });
      console.log(`配置文件已生成：${configPath}（请填写 api_key）`);
    }
    const report = checkConfigPermissions(configPath);
    if (report.status === "insecure") {
      console.warn(`警告：${report.detail}`);
    } else if (report.status !== "ok") {
      console.log(report.detail);
    }
    break;
  }
  case "serve": {
    const { values } = parseArgs({
      args: rest,
      options: { port: { type: "string", default: String(DEFAULT_PORT) } },
    });
    const port = Number(values.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      console.error(`非法端口：${values.port}`);
      process.exit(1);
    }
    // 与 init 同一道密钥权限检查（issue #15）：warn 不阻断。
    const configPath = findConfigPath();
    if (configPath) {
      const report = checkConfigPermissions(configPath);
      if (report.status === "insecure") console.warn(`警告：${report.detail}`);
    }
    try {
      const server = await startServer({ port });
      console.log(`Lingua Web Chat 已启动：http://localhost:${server.port}`);
      console.log(`好友角色：${server.card.name}｜数据目录：${dataDir()}`);
      process.on("SIGINT", () => {
        void server.close().then(() => process.exit(0));
      });
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
    break;
  }
  case "backup": {
    const { values } = parseArgs({
      args: rest,
      options: { keep: { type: "string", default: String(DEFAULT_KEEP_LAST) } },
    });
    const keepLast = Number(values.keep);
    const dir = dataDir();
    const result = runBackup({
      sourcePath: join(dir, "lingua.db"),
      backupDir: join(dir, "backups"),
      keepLast,
      clock: new SystemClock(),
    });
    console.log(`备份完成：${result.backupPath}`);
    for (const path of result.prunedPaths) {
      console.log(`已按保留策略删除旧备份：${path}`);
    }
    break;
  }
  case "restore": {
    const [backupPath, targetPath] = rest;
    if (!backupPath || !targetPath) usage();
    restoreBackup({ backupPath, targetPath });
    console.log(`已恢复：${backupPath} → ${targetPath}`);
    break;
  }
  default:
    usage();
}
