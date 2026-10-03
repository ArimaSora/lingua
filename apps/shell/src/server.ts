import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  ensureLearnerProfile,
  formatScaffoldingSuggestion,
  getPendingSuggestion,
  loadCharacterCard,
  loadKnowledgeEntries,
  migrate,
  openBootstrap,
  openContentPipeline,
  openDatabase,
  openEventStore,
  openExplanationLog,
  openKnowledgeStore,
  openMessageStore,
  openScheduler,
  parseBootstrapPack,
  proposeScaffoldingTier,
  runBackup,
  SystemClock,
  type CharacterCard,
  type ContentExtractor,
  type ContentPipeline,
  type ContentSimplifier,
  type CoarseGrader,
  type Database,
  type PerishabilityTagger,
  type Scheduler,
  type Wordlist,
} from "@lingua/core";
import { createCompanionAgent, type CompanionAgent } from "./agent";
import { createReadabilityExtractor } from "./content-extractor";
import { loadConfig, resolveHome } from "./config";
import { dataDir } from "./data-dir";
import { createMainSimplifier } from "./simplifier";
import {
  formatIngestReply,
  handleSystemMessage,
  SystemUrlIntentError,
  SYSTEM_CONTACT_NAME,
  SYSTEM_WELCOME,
} from "./system-contact";
import { loadEfllexWordlist } from "./wordlist-loader";

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
  // 内容管道依赖可注入，便于 e2e 控制。
  extractor?: ContentExtractor;
  simplifier?: ContentSimplifier;
  wordlist?: Wordlist;
  grader?: CoarseGrader | null;
  tagger?: PerishabilityTagger | null;
};

export type RunningServer = {
  port: number;
  db: Database;
  card: CharacterCard;
  // 唯一调度器（issue #6）：课包推送与定时备份的 tick 入口，e2e 可手动驱动。
  scheduler: Scheduler;
  // 票 10：内容管道入口，供测试/CLI 直接检查分流结果。
  pipeline: ContentPipeline;
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
// 解锁队列过期清理：每日一次（issue #10）。
const UNLOCK_QUEUE_EXPIRE_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  // 学习者档案初始化（issue #13）：以角色卡档位为默认值，不覆盖既有手动设置。
  ensureLearnerProfile({ db, clock, language, cardTier: card.scaffoldingTier });
  const store = openMessageStore({ db, clock });

  // 系统会话播种欢迎文案（仅首次）。
  if (store.list({ language, contact: "system" }).length === 0) {
    store.append({ language, contact: "system", role: "assistant", text: SYSTEM_WELCOME });
  }

  // 内容管道（issue #10）：无 key 时 simplifier 抛错，pipeline 自动降级为解锁队列。
  const extractor = options.extractor ?? createReadabilityExtractor();
  const simplifier =
    options.simplifier ??
    (() => {
      try {
        return createMainSimplifier(options.model ?? buildModel(options.configPath));
      } catch {
        // 优雅降级：缺少模型配置时无法改写，难文全部进解锁队列。
        return async () => {
          throw new Error("未配置主模型，无法生成简化版");
        };
      }
    })();
  const wordlist = options.wordlist ?? loadEfllexWordlist(dir);
  const pipeline = openContentPipeline({
    db,
    clock,
    language,
    extractor,
    simplifier,
    wordlist,
    grader: options.grader,
    tagger: options.tagger,
  });

  const model = options.model ?? buildModel(options.configPath);
  // 知识条目库（issue #12）：随包种子内容，启动时加载并全量校验。
  const knowledge = openKnowledgeStore({ entries: loadKnowledgeEntries() });
  const agent: CompanionAgent = createCompanionAgent({ model, db, clock, card, knowledge });

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

  // 唯一调度器：课包推送（每 tick 检查，完成预学才推下一课）+ 定时备份 + 解锁队列过期清理。
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
      {
        id: "unlock-queue-expire",
        intervalMs: UNLOCK_QUEUE_EXPIRE_INTERVAL_MS,
        run: () => {
          pipeline.expireUnlockQueue();
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
        // 讲解投递记录查询（issue #12）：某条消息引用过的知识条目 + 证据等级 + 层。
        if (req.method === "GET" && url.pathname === "/api/explanations") {
          const messageId = url.searchParams.get("messageId");
          if (typeof messageId !== "string" || messageId.length === 0) {
            json(res, 400, { error: "需要 messageId 查询参数" });
            return;
          }
          json(res, 200, openExplanationLog({ db, clock }).forMessage(messageId));
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
            let systemResult: ReturnType<typeof handleSystemMessage>;
            try {
              systemResult = handleSystemMessage({
                text: body.text.trim(),
                db,
                clock,
                bootstrap,
                pipeline,
                language,
              });
            } catch (error) {
              if (error instanceof SystemUrlIntentError) {
                const result = await pipeline.ingest({ url: error.url });
                systemResult = { reply: formatIngestReply(result), skipSuggestion: false };
              } else {
                throw error;
              }
            }
            const reply = store.append({
              language,
              contact: "system",
              role: "assistant",
              text: systemResult.reply,
            });
            // 系统依据事件流提出建议，以消息形式出现；未经确认不改变行为。
            if (!systemResult.skipSuggestion && !getPendingSuggestion({ db, language })) {
              const suggestion = proposeScaffoldingTier({ db, clock, language });
              if (suggestion) {
                store.append({
                  language,
                  contact: "system",
                  role: "assistant",
                  text: formatScaffoldingSuggestion(suggestion),
                });
              }
            }
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
    pipeline,
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
