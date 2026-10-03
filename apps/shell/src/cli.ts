import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { migrate, openDatabase, SCHEMA_VERSION } from "@lingua/core";
import { dataDir } from "./data-dir";
import { DEFAULT_PORT, startServer } from "./server";

function usage(): never {
  console.error(
    "usage: lingua <command>\n\ncommands:\n" +
      "  init              初始化数据目录与 SQLite schema\n" +
      "  serve [--port N]  启动 Web Chat（默认端口 " +
      DEFAULT_PORT +
      "）",
  );
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

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
  case "serve": {
    const portArg = flagValue("--port");
    const port = portArg === undefined ? DEFAULT_PORT : Number(portArg);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      console.error(`非法端口：${portArg}`);
      process.exit(1);
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
  default:
    usage();
}
