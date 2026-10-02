import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase, SCHEMA_VERSION } from "@lingua/core";

// 数据目录默认在仓库外（~/.lingua/），个人学习数据无入库路径。
export function dataDir(): string {
  return process.env.LINGUA_DATA_DIR ?? join(homedir(), ".lingua");
}

function usage(): never {
  console.error("usage: lingua <command>\n\ncommands:\n  init    初始化数据目录与 SQLite schema");
  process.exit(1);
}

const [command] = process.argv.slice(2);

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
    break;
  }
  default:
    usage();
}
