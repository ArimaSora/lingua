import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  loadCharacterCard,
  migrate,
  openBootstrap,
  openDatabase,
  openEventStore,
  openMessageStore,
  openScheduler,
  parseBootstrapPack,
  runBackup,
  SystemClock,
  type CharacterCard,
  type Database,
  type Scheduler,
} from "@lingua/core";
import { createCompanionAgent, type CompanionAgent } from "./agent";
import { loadConfig, resolveHome } from "./config";
import { handleSystemMessage, SYSTEM_CONTACT_NAME, SYSTEM_WELCOME } from "./system-contact";
import { dataDir } from "./data-dir";

// Web Chat 壳（issue #5）：IM 界面 + JSON API，直连 agent loop（ADR-0017）。
// 静态页为无构建步骤的原生 HTML/JS，消息经 lingua-core message store 持久化。

export const DEFAULT_PORT = 3939;

export type StartServerOptions = {
  dataDir?: string;
  port?: number;
  configPath?: string;
  // 注入假模型时跳过 config.toml（e2e 冒烟用）。
  model?: LanguageModel;
  cardPath?: string;
  packPath?: string;
};

export type RunningServer = {
  port: number;
  db: Database;
  card: CharacterCard;
  // 唯一调度器（issue #6）：课包推送与定时备份的 tick 入口，e2e 可手动驱动。
  scheduler: Scheduler;
  close(): Promise<void>;
};

const INDEX_HTML = fileURLToPath(new URL("../public/index.html", import.meta.url));
const DEFAULT_CARD = fileURLToPath(new URL("../cards/default-companion.json", import.meta.url));
const DEFAULT_PACK = fileURLToPath(new URL("../packs/en-bootstrap-a1.json", import.meta.url));

// 调度器节奏（issue #6）：tick 本身幂等廉价，壳层每分钟戳一次；
// 备份每日一次、保留最近 7 份（与 cli backup 子命令默认一致）。
const TICK_INTERVAL_MS = 60_000;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_KEEP_LAST = 7;

function readCard(cardPath: string | undefined, dir: string): unknown {
  const candidates = cardPath ? [resolveHome(cardPath)] : [join(dir, "companion.json")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")) as unknown;
    }
  }
  return JSON.parse(readFileSync(DEFAULT_CARD, "utf8")) as unknown;
}

function readPack(packPath: string | undefined, dir: string): unknown {
  const candidates = packPath ? [resolveHome(packPath)] : [join(dir, "bootstrap-pack.json")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")) as unknown;
    }
  }
  return JSON.parse(readFileSync(DEFAULT_PACK, "utf8")) as unknown;
}

function buildModel(configPath?: string): LanguageModel {
  const config = loadConfig(configPath);
  const provider = createOpenAICompatible({
    name: config.main.provider,
    baseURL: config.main.baseUrl,
    apiKey: config.main.apiKey,
  });
  return provider.chatModel(config.main.model);
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const dir = options.dataDir ?? dataDir();
  mkdirSync(dir, { recursive: true });
  const db = openDatabase(join(dir, "lingua.db"));
  migrate(db);
  const clock = new SystemClock();
  // 事件存储初始化会写入默认参数快照——digest 投影依赖它（ticket 03 契约）。
  openEventStore({ db, clock });

  // 角色卡：数据目录 companion.json > 显式路径 > 内置默认卡；幂等加载。
  const card = loadCharacterCard({ db, clock, card: readCard(options.cardPath, dir) });
  const language = card.languagePair.target;
  const store = openMessageStore({ db, clock });

  // 系统会话播种欢迎文案（仅首次）。
  if (store.list({ language, contact: "system" }).length === 0) {
    store.append({ language, contact: "system", role: "assistant", text: SYSTEM_WELCOME });
  }

  const model = options.model ?? buildModel(options.configPath);
  const agent: CompanionAgent = createCompanionAgent({ model, db, clock, card });

  // Bootstrap 课包（issue #6）：数据目录 bootstrap-pack.json > 显式路径 > 内置首批课包；
  // 播种幂等。课包语言须与角色目标语言一致，否则推送落不进当前系统会话。
  const pack = parseBootstrapPack(readPack(options.packPath, dir));
  if (pack.language !== language) {
    throw new Error(
      `Bootstrap 课包语言（${pack.language}）与角色目标语言（${language}）不一致`,
    );
  }
  const bootstrap = openBootstrap({ db, clock });
  bootstrap.seedPack(pack);

  // 唯一调度器：课包推送（每 tick 检查，完成预学才推下一课）+ 定时备份。
  // 票 04 的额度入账是查询时惰性结算，调度器不重复实现其 tick（ADR-0016）。
  const scheduler = openScheduler({
    db,
    clock,
    tasks: [
      {
        id: "bootstrap-push",
        intervalMs: 0,
        run: () => void bootstrap.pushNextLesson(language),
      },
      {
        id: "backup",
        intervalMs: BACKUP_INTERVAL_MS,
        run: () => {
          runBackup({
            sourcePath: join(dir, "lingua.db"),
            backupDir: join(dir, "backups"),
            keepLast: BACKUP_KEEP_LAST,
            clock,
          });
        },
      },
    ],
  });
  const runTick = () => {
    for (const error of scheduler.tick().errors) {
      console.error(`调度任务 ${error.taskId} 失败：${error.message}`);
    }
  };
  runTick();
  const tickTimer = setInterval(runTick, TICK_INTERVAL_MS);
  // 不拖住进程退出：server.close 之外的路径（如 CLI 错误分支）也不泄漏句柄。
  tickTimer.unref();

  const contacts = [
    { id: "system", name: SYSTEM_CONTACT_NAME },
    { id: "companion", name: card.name },
  ];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        if (req.method === "GET" && url.pathname === "/") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(readFileSync(INDEX_HTML));
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/contacts") {
          json(res, 200, contacts);
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/messages") {
          const contact = url.searchParams.get("contact");
          if (contact !== "system" && contact !== "companion") {
            json(res, 400, { error: "contact 需为 system 或 companion" });
            return;
          }
          json(res, 200, store.list({ language, contact }));
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/messages") {
          const body = (await readBody(req)) as { contact?: unknown; text?: unknown };
          if (
            (body.contact !== "system" && body.contact !== "companion") ||
            typeof body.text !== "string" ||
            body.text.trim().length === 0
          ) {
            json(res, 400, { error: "需要 contact（system|companion）与非空 text" });
            return;
          }
          if (body.contact === "system") {
            store.append({ language, contact: "system", role: "user", text: body.text.trim() });
            const reply = store.append({
              language,
              contact: "system",
              role: "assistant",
              text: handleSystemMessage({ text: body.text.trim(), bootstrap, language }),
            });
            json(res, 200, reply);
            return;
          }
          const reply = await agent.reply(body.text.trim());
          json(res, 200, reply);
          return;
        }
        json(res, 404, { error: "not found" });
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
    })();
  });

  const port = options.port ?? DEFAULT_PORT;
  await new Promise<void>((resolveListen) => server.listen(port, resolveListen));
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    port: boundPort,
    db,
    card,
    scheduler,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        clearInterval(tickTimer);
        // Windows 上 SQLite 文件句柄不释放则数据目录无法清理；同时强制断开
        // keep-alive 连接，避免 server.close 等待悬挂套接字。
        server.closeAllConnections();
        server.close((error) => {
          if (error) return rejectClose(error);
          try {
            db.close();
            resolveClose();
          } catch (closeError) {
            rejectClose(closeError as Error);
          }
        });
      }),
  };
}
