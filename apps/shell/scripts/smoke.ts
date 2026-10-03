import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { TRANSLATION_MARKER } from "../src/agent";
import { startServer } from "../src/server";

// 假模型 e2e 冒烟（issue #5）：无 API key 环境下证明完整链路——
// 双联系人列表、工具循环（remember_fact 写策展事实）、digest 注入下一轮 prompt、
// 翻译标记拆分与可展开渲染数据、系统联系人纯工具文案、SQLite 持久化（跨重启）。
// 运行：pnpm --filter @lingua/shell smoke

const dir = mkdtempSync(join(tmpdir(), "lingua-smoke-"));

const systemsSeen: string[] = [];
const REMEMBERED_FACT = "用户在学 agent 方向的英语";
const REPLY_TEXT = "hey! not much, just tinkering with a little agent project. you?";
const REPLY_TRANSLATION = "嘿！没什么，就是在折腾一个小 agent 项目。你呢？";

let explanationMessageId = "";

let callCount = 0;
const fakeModel = new MockLanguageModelV4({
  doGenerate: async (options) => {
    callCount += 1;
    systemsSeen.push(typeof options.prompt === "string" ? options.prompt : JSON.stringify(options.prompt));
    if (callCount === 1) {
      // 第一轮先调 remember_fact 工具，证明工具循环装配正确。
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "remember_fact",
            input: JSON.stringify({ fact: REMEMBERED_FACT }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        warnings: [],
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
      };
    }
    if (callCount === 4) {
      // 讲解轮：模型按目录选择条目并调用 lookup_knowledge_entry（issue #12）。
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-4",
            toolName: "lookup_knowledge_entry",
            input: JSON.stringify({ id: "mindset-tense-marking" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        warnings: [],
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
      };
    }
    if (callCount === 5) {
      const text =
        "good question! English verbs always carry time info — “see” has to become “saw” for yesterday. 【mindset-tense-marking】";
      return {
        content: [{ type: "text", text: `${text}\n${TRANSLATION_MARKER}\n问得好！英语动词必须带时间信息，昨天就得用 saw。【mindset-tense-marking】` }],
        finishReason: { unified: "stop" as const, raw: undefined },
        warnings: [],
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
      };
    }
    return {
      content: [{ type: "text", text: `${REPLY_TEXT}\n${TRANSLATION_MARKER}\n${REPLY_TRANSLATION}` }],
      finishReason: { unified: "stop" as const, raw: undefined },
      warnings: [],
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
    };
  },
});

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`));
}

const base = (port: number) => `http://localhost:${port}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string): Promise<any> {
  return fetch(url).then((r) => r.json());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postJson(url: string, body: unknown): Promise<any> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

let server: Awaited<ReturnType<typeof startServer>> | undefined;
try {
  server = await startServer({ dataDir: dir, port: 0, model: fakeModel });
  const api = base(server.port);

  await check("联系人列表恰为系统 + 好友角色", async () => {
    const contacts = await getJson(`${api}/api/contacts`);
    assert.deepEqual(contacts, [
      { id: "system", name: "系统" },
      { id: "companion", name: "Maya" },
    ]);
  });

  await check("页面含 IM 布局与可展开翻译渲染", async () => {
    const html = await fetch(`${api}/`).then((r) => r.text());
    assert.match(html, /id="sidebar"/);
    assert.match(html, /createElement\("details"\)/);
    assert.match(html, /中文翻译/);
  });

  await check("一轮完整对话：工具循环 + 翻译拆分", async () => {
    const reply = await postJson(`${api}/api/messages`, {
      contact: "companion",
      text: "hi Maya! what are you up to?",
    });
    assert.equal(reply.role, "assistant");
    assert.equal(reply.text, REPLY_TEXT);
    assert.equal(reply.translation, REPLY_TRANSLATION);
    assert.equal(callCount, 2, "工具循环应为两步（tool-call → text）");
  });

  await check("系统提示含人格、翻译标记指令与 digest 区", () => {
    assert.match(systemsSeen[0]!, /You are Maya/);
    assert.match(systemsSeen[0]!, new RegExp(TRANSLATION_MARKER.replace(/[[\]]/g, "\\$&")));
    assert.match(systemsSeen[0]!, /casual and neutral/);
  });

  await check("消息持久化：用户与角色消息按序落库，翻译随消息保存", async () => {
    const messages = await getJson(`${api}/api/messages?contact=companion`);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[0].text, "hi Maya! what are you up to?");
    assert.equal(messages[1].role, "assistant");
    assert.equal(messages[1].translation, REPLY_TRANSLATION);
  });

  await check("系统联系人：纯工具文案，不触发模型调用", async () => {
    const reply = await postJson(`${api}/api/messages`, {
      contact: "system",
      text: "https://example.com/feed.xml",
    });
    assert.equal(reply.role, "assistant");
    assert.match(reply.text, /工具通道/);
    assert.equal(callCount, 2, "系统会话不得经过模型");
    const messages = await getJson(`${api}/api/messages?contact=system`);
    assert.equal(messages.length, 3, "欢迎文案 + 用户消息 + 系统回复");
    assert.match(messages[0].text, /系统已上线/);
  });

  await check("工具写入的策展事实经 digest 注入下一轮 prompt", async () => {
    await postJson(`${api}/api/messages`, { contact: "companion", text: "tell me more" });
    assert.equal(callCount, 3, "第二轮无工具调用，一次生成");
    assert.match(systemsSeen[2]!, new RegExp(REMEMBERED_FACT));
    assert.match(systemsSeen[2]!, /共同兴趣：AI agents/);
  });

  await check("讲解入口：lookup_knowledge_entry 工具接地真实条目并引用条目 ID（issue #12）", async () => {
    const reply = await postJson(`${api}/api/messages`, {
      contact: "companion",
      text: "为什么英语要说 I saw him yesterday，see 不用变形吗？",
    });
    assert.equal(callCount, 5, "讲解轮应为两步（tool-call → text）");
    assert.equal(reply.role, "assistant");
    assert.match(reply.text, /【mindset-tense-marking】/, "回复必须引用知识条目 ID");
    // 工具结果直接来自随包种子库的真实条目内容（grounding，非模型编造）。
    assert.match(systemsSeen[4]!, /英语每个动词都得带上/);
    assert.match(systemsSeen[4]!, /证据等级：学界共识/);
    explanationMessageId = reply.id as string;
  });

  await check("讲解可追溯：投递记录挂消息持久化，含条目 ID + 证据等级 + 层", async () => {
    const refs = await getJson(`${api}/api/explanations?messageId=${explanationMessageId}`);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].entryId, "mindset-tense-marking");
    assert.equal(refs[0].evidenceLevel, "学界共识");
    assert.equal(refs[0].layer, 1);
  });

  await check("持久化跨重启：重开服务后消息仍在", async () => {
    const first = server!;
    await first.close();
    server = undefined;
    const reopened = await startServer({ dataDir: dir, port: 0, model: fakeModel });
    server = reopened;
    try {
      const messages = await getJson(`${base(reopened.port)}/api/messages?contact=companion`);
      assert.equal(messages.length, 6, "三轮对话的消息应全部保留");
      assert.equal(messages[1].translation, REPLY_TRANSLATION);
      const refs = await getJson(
        `${base(reopened.port)}/api/explanations?messageId=${explanationMessageId}`,
      );
      assert.equal(refs.length, 1, "讲解引用应随数据库跨重启保留");
      const system = await getJson(`${base(reopened.port)}/api/messages?contact=system`);
      assert.equal(system.length, 3, "系统会话不重复播种欢迎文案");
    } finally {
      await reopened.close();
      server = undefined;
    }
  });

  console.log("\n冒烟通过：双联系人 Web Chat 全链路（假模型）");
} finally {
  // 先释放 SQLite 句柄（Windows 上不释放则删不掉数据目录），再清理临时目录。
  if (server) await server.close().catch(() => {});
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.warn(`警告：临时目录清理失败（可手动删除）：${dir}`);
  }
}
