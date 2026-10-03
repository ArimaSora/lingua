import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  loadCharacterCard,
  loadKnowledgeEntries,
  migrate,
  openDatabase,
  openEventStore,
  openExplanationLog,
  openKnowledgeStore,
  openMessageStore,
  SystemClock,
  type CharacterCard,
  type Database,
} from "@lingua/core";
import { createCompanionAgent, type CompanionAgent } from "./agent";
import { loadConfig, resolveHome } from "./config";
import { SYSTEM_CONTACT_NAME, SYSTEM_WELCOME, systemReply } from "./system-contact";
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
};

export type RunningServer = {
  port: number;
  db: Database;
  card: CharacterCard;
  close(): Promise<void>;
};

const INDEX_HTML = fileURLToPath(new URL("../public/index.html", import.meta.url));
const DEFAULT_CARD = fileURLToPath(new URL("../cards/default-companion.json", import.meta.url));

function readCard(cardPath: string | undefined, dir: string): unknown {
  const candidates = cardPath ? [resolveHome(cardPath)] : [join(dir, "companion.json")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")) as unknown;
    }
  }
  return JSON.parse(readFileSync(DEFAULT_CARD, "utf8")) as unknown;
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
  // 知识条目库（issue #12）：随包种子内容，启动时加载并全量校验。
  const knowledge = openKnowledgeStore({ entries: loadKnowledgeEntries() });
  const agent: CompanionAgent = createCompanionAgent({ model, db, clock, card, knowledge });

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
            const reply = store.append({
              language,
              contact: "system",
              role: "assistant",
              text: systemReply(body.text),
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
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
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
