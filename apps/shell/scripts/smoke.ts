import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { openEventStore, SystemClock } from "@lingua/core";
import { TRANSLATION_MARKER } from "../src/agent";
import { startServer } from "../src/server";

// 假模型 e2e 冒烟（issue #5 + #6 + #10）：无 API key 环境下证明完整链路——
// 双联系人列表、工具循环（remember_fact 写策展事实）、digest 注入下一轮 prompt、
// 翻译标记拆分与可展开渲染数据、系统联系人链接入口（正文抓取 → 难度管道 → 分流）、
// SQLite 持久化（跨重启）、Bootstrap 课包推送（调度器 tick）与预学完成闭环。
// 运行：pnpm --filter @lingua/shell smoke

const dir = mkdtempSync(join(tmpdir(), "lingua-smoke-"));

const systemsSeen: string[] = [];
const REMEMBERED_FACT = "用户在学 agent 方向的英语";
const REPLY_TEXT = "hey! not much, just tinkering with a little agent project. you?";
const REPLY_TRANSLATION = "嘿！没什么，就是在折腾一个小 agent 项目。你呢？";

let explanationMessageId = "";

// 票 10：系统会话链接入口的 fake 依赖（避免真实网络与模型调用）。
const EASY_BODY = "I am big and you are small.";
const HARD_BODY = "Government increase substantial however ubiquitous.";
const fakeExtractor = async (url: string) => {
  if (url.includes("/2026/")) return { title: "Hard News", body: HARD_BODY };
  if (url.includes("/essays/")) return { title: "Hard Essay", body: HARD_BODY };
  return { title: "Easy Article", body: EASY_BODY };
};
const fakeSimplifier = async ({ body, url }: { body: string; url: string }) => ({
  title: "简化版",
  body: `[简化版] ${body}\n原文链接：${url}`,
});

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
        'good question! English verbs always carry time info — "see" has to become "saw" for yesterday. [[register:formal]]is required to[[register:neutral]] change. 【mindset-tense-marking】';
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
  server = await startServer({
    dataDir: dir,
    port: 0,
    model: fakeModel,
    extractor: fakeExtractor,
    simplifier: fakeSimplifier,
    rssFetcher: async () => "<?xml version=\"1.0\"?><rss></rss>",
  });
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

  await check("启动即推送 Bootstrap 第一课：钩子 + 可展开预学清单标记 + 正文", async () => {
    const messages = await getJson(`${api}/api/messages?contact=system`);
    assert.equal(messages.length, 2, "欢迎文案 + 第一课推送");
    assert.match(messages[0].text, /系统已上线/);
    const push = messages[1];
    assert.equal(push.role, "assistant");
    assert.match(push.text, /【Bootstrap 课包 · 第 1\/5 课】First contact/);
    assert.match(push.text, /为什么你会感兴趣：/);
    assert.match(push.text, /\[\[预学清单\]\]/);
    assert.match(push.text, /how's it going/);
    assert.match(push.text, /例句：/);
    assert.match(push.text, /直觉规律：/);
    assert.match(push.text, /Nice to meet you!/);
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

  await check("系统联系人：普通链接走内容管道，不触发模型调用", async () => {
    const reply = await postJson(`${api}/api/messages`, {
      contact: "system",
      text: "https://example.com/feed.xml",
    });
    assert.equal(reply.role, "assistant");
    assert.match(reply.text, /已收到链接/);
    assert.equal(callCount, 2, "系统会话不得经过模型");
    const messages = await getJson(`${api}/api/messages?contact=system`);
    assert.equal(messages.length, 4, "欢迎文案 + 第一课推送 + 用户消息 + 系统回复");
    assert.match(messages[0].text, /系统已上线/);
  });

  await check("系统联系人：常青难文进解锁队列，标签「原文难度约 X」", async () => {
    const reply = await postJson(`${api}/api/messages`, {
      contact: "system",
      text: "https://example.com/essays/attention",
    });
    assert.equal(reply.role, "assistant");
    assert.match(reply.text, /已收入解锁队列/);
    assert.match(reply.text, /原文难度约/);
    assert.equal(callCount, 2, "解锁队列入队不经过模型");

    const queue = server!.pipeline.listUnlockQueue();
    assert.equal(queue.length, 1);
    assert.match(queue[0]!.unlockLabel, /原文难度约/);
  });

  await check("系统联系人：易腐难文走简化版出路，不进解锁队列", async () => {
    const reply = await postJson(`${api}/api/messages`, {
      contact: "system",
      text: "https://news.example.com/2026/10/03/agent-release",
    });
    assert.equal(reply.role, "assistant");
    assert.match(reply.text, /已生成简化版/);
    assert.match(reply.text, /原文链接：/);
    assert.equal(callCount, 2, "fake 简化器不经过模型");

    const queue = server!.pipeline.listUnlockQueue();
    assert.equal(queue.length, 1, "简化版不进解锁队列");
  });

  await check("预学完成闭环：回「完成」记 initial-learning，tick 推下一课", async () => {
    const reply = await postJson(`${api}/api/messages`, {
      contact: "system",
      text: "完成",
    });
    assert.equal(reply.role, "assistant");
    assert.match(reply.text, /已记录预学：5 个语块/);
    assert.equal(callCount, 2, "预学完成不经过模型");

    const belief = openEventStore({ db: server!.db, clock: new SystemClock() }).currentBeliefAt(
      Date.now(),
    );
    const initial = belief.chunks.filter((chunk) => chunk.lastEventType === "initial-learning");
    assert.equal(initial.length, 5, "第一课 5 个语块各记一条 initial-learning");
    assert.ok(
      initial.every((chunk) => chunk.admittedEvidence === 0 && chunk.reps === 0),
      "预学不冒充成功回忆、不更新掌握度（ADR-0016）",
    );

    // 调度器 tick：上一课预学完成 → 推送第二课。
    const report = server!.scheduler.tick();
    assert.ok(report.ran.includes("bootstrap-push"));
    const messages = await getJson(`${api}/api/messages?contact=system`);
    assert.equal(messages.length, 11, "欢迎+第一课+三个链接往返+完成往返+第二课推送");
    assert.match(messages[10].text, /【Bootstrap 课包 · 第 2\/5 课】日常救场/);
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
    assert.doesNotMatch(reply.text, /\[\[register:/, "标记应被剥离，不留在展示文本中");
    assert.equal(reply.annotations.length, 1, "语域标注应被拆分持久化");
    assert.equal(reply.annotations[0].register, "formal");
    assert.equal(reply.annotations[0].label, "较正式");
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

  await check("页面渲染语域标注（带 register 类名的 span）", async () => {
    const html = await fetch(`${api}/`).then((r) => r.text());
    assert.match(html, /register-formal/);
    assert.match(html, /register-casual/);
    assert.match(html, /register-neutral/);
  });

  await check("页面含留白式纠错折叠渲染（点开看参考答案，issue #8）", async () => {
    const html = await fetch(`${api}/`).then((r) => r.text());
    assert.match(html, /\[\[纠错\]\]/, "应识别小结的纠错标记");
    assert.match(html, /参考答案/, "折叠摘要/正文出现参考答案入口");
  });

  await check("系统会话可手动调档，立即生效", async () => {
    const reply = await postJson(`${api}/api/messages`, { contact: "system", text: "支架 on-request" });
    assert.equal(reply.role, "assistant");
    assert.match(reply.text, /已调至 on-request/);
  });

  await check("调档后角色消息翻译折叠跟随档位关闭", async () => {
    const reply = await postJson(`${api}/api/messages`, { contact: "companion", text: "hi again" });
    assert.equal(reply.role, "assistant");
    assert.equal(reply.translation, null, "on-request 档不应保存翻译");
    assert.equal(callCount, 6, "调档后角色轮仍走模型一次");
  });

  await check("系统小结：话题结束后进入系统会话，角色会话零打断（issue #8）", async () => {
    const systemBefore = await getJson(`${api}/api/messages?contact=system`);
    const companionBefore = await getJson(`${api}/api/messages?contact=companion`);

    // 直接构造一个 31 分钟前开的话题（触发 30 分钟空闲边界）+ 3 条错误日志
    //（同时满足错误阈值）。无 API key，不经模型：投递是纯规则路径。
    const now = Date.now();
    server!.db
      .prepare(
        `INSERT INTO ambush_topics (id, language, status, topic_text, prompt, opened_at, closed_at)
         VALUES (?, ?, 'open', ?, ?, ?, NULL)`,
      )
      .run("smoke-topic", "en", "How was your weekend?", "smoke prompt", now - 31 * 60 * 1000);
    const insertError = server!.db.prepare(
      `INSERT INTO error_logs (id, language, original_text, topic_id, phenomenon, correction, created_at)
       VALUES (?, 'en', ?, 'smoke-topic', ?, ?, ?)`,
    );
    insertError.run("smoke-e1", "I look up it.", "这个表达里有个地方不太对，能发现吗？", "参考答案：look it up", now - 40 * 60 * 1000);
    insertError.run("smoke-e2", "He go to school.", "这句话的动词形式有什么问题？", "参考答案：He goes to school.", now - 39 * 60 * 1000);
    insertError.run("smoke-e3", "I am agree.", "agree 前面需要 be 动词吗？", "参考答案：I agree.", now - 38 * 60 * 1000);

    const report = server!.scheduler.tick();
    assert.ok(report.ran.includes("system-digest"), `调度应运行 system-digest（ran: ${report.ran.join(",")}）`);

    const systemAfter = await getJson(`${api}/api/messages?contact=system`);
    assert.equal(systemAfter.length, systemBefore.length + 1, "恰投递一条系统小结");
    const digest = systemAfter[systemAfter.length - 1];
    assert.equal(digest.role, "assistant");
    assert.match(digest.text, /【系统小结】/);
    assert.match(digest.text, /话题已结束/);
    assert.match(digest.text, /判分回顾/);
    assert.match(digest.text, /\[\[纠错\]\]/, "小结含留白式纠错标记（点开看参考答案）");
    assert.match(digest.text, /明日到期/);

    const companionAfter = await getJson(`${api}/api/messages?contact=companion`);
    assert.equal(companionAfter.length, companionBefore.length, "角色会话零打断：消息数不变");
    for (const message of companionAfter) {
      assert.doesNotMatch(message.text, /【系统小结】|\[\[纠错\]\]/, "角色会话不得出现学习性纠错");
    }

    // 幂等：同一话题再次 tick 不重复投递（digest_sent_at 标记）。
    server!.scheduler.tick();
    const systemFinal = await getJson(`${api}/api/messages?contact=system`);
    assert.equal(systemFinal.length, systemAfter.length, "重复 tick 不重复投递小结");
  });

  await check("持久化跨重启：重开服务后消息仍在", async () => {
    const first = server!;
    await first.close();
    server = undefined;
    const reopened = await startServer({
      dataDir: dir,
      port: 0,
      model: fakeModel,
      rssFetcher: async () => "<?xml version=\"1.0\"?><rss></rss>",
    });
    server = reopened;
    try {
      const messages = await getJson(`${base(reopened.port)}/api/messages?contact=companion`);
      assert.equal(messages.length, 8, "四轮对话的消息应全部保留");
      assert.equal(messages[1].translation, REPLY_TRANSLATION);
      const refs = await getJson(
        `${base(reopened.port)}/api/explanations?messageId=${explanationMessageId}`,
      );
      assert.equal(refs.length, 1, "讲解引用应随数据库跨重启保留");
      const system = await getJson(`${base(reopened.port)}/api/messages?contact=system`);
      assert.equal(
        system.length,
        14,
        "系统会话不重复播种欢迎文案，课包不重复推送，链接、调档与系统小结历史保留",
      );
      assert.match(system[13]!.text, /【系统小结】/, "小结随库保留");
      // 重启后 tick：第二课仍待预学完成，不推新课；备份按间隔节流。
      const report = reopened.scheduler.tick();
      assert.equal(
        system.length,
        (await getJson(`${base(reopened.port)}/api/messages?contact=system`)).length,
        `重启 tick 不应推新课（ran: ${report.ran.join(",")}）`,
      );
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
