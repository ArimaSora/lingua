# 调研：用 TypeScript 构建个人 AI Agent，并以可扩展模块方式实现语言学习功能

- 调研日期：2026-10-02
- 方法：仅采用一手来源（官方文档站、GitHub 仓库与 GitHub/npm API、规范原文、论文/官方出版物）；版本号与 star 数均为 2026-10-02 当日实测数据。
- 局限与不确定性见文末「附：未能核实/不确定项」。

---

## 1. 摘要（TL;DR）

**核心推荐**

- **框架选型：推荐 Mastra**（`@mastra/core@1.74.0`，2026-10-01 发布）。理由：它是本次调研中唯一同时内建「Agent + 图工作流 + 持久化记忆 + 内建 cron 调度 + 双向 MCP（客户端/服务端）」的 TS 框架，且默认存储为本地 SQLite（LibSQL），天然契合「个人、本地优先、可主动提醒」的语言学习 agent 场景（[Mastra GitHub](https://github.com/mastra-ai/mastra)、[Mastra MCP 文档](https://mastra.ai/docs/connections/mcp)、[Mastra Schedules 文档](https://mastra.ai/docs/harness/schedules)、[Mastra Memory 文档](https://mastra.ai/docs/memory/overview)）。
- **若只做轻量聊天+工具循环，Vercel AI SDK 7 是更薄的底座**（`ai@7.0.127`），但记忆、调度都需自建（[AI SDK Agents 文档](https://ai-sdk.dev/docs/agents/overview)）。
- **模块形态：推荐「进程内工具集为主 + 可选 MCP server 暴露」的混合方案**。语言学习数据（词汇卡、FSRS 状态、学习日志）放进本地 SQLite；SRS 调度用 `ts-fsrs@5.4.2`（MIT，2026-09-01 发布）进程内调用（[ts-fsrs 仓库](https://github.com/open-spaced-repetition/ts-fsrs)）。Mastra 的 `MCPServer` 可把同一批工具一键暴露为 MCP server，未来可被 Claude Desktop 等其他客户端复用（[Mastra MCP 文档](https://mastra.ai/docs/connections/mcp)）。
- **若用户已是 Anki 重度用户，考虑不重复造轮子**：通过 AnkiConnect（本地 HTTP API，`localhost:8765`）或现成的 Anki MCP server（如 `ankimcp/anki-mcp-server`，53 个工具）让 agent 直接读写 Anki，而非自建卡组库（[AnkiConnect 文档](https://git.sr.ht/~foosoft/anki-connect)、[anki-mcp-server 仓库](https://github.com/ankimcp/anki-mcp-server)）。

**关键判断**

1. 2026 年 TS agent 框架已明显分层：薄 SDK（AI SDK）、全栈框架（Mastra、VoltAgent）、编排层（LangGraph.js）、官方垂直 SDK（OpenAI Agents JS，强项是语音 realtime）。
2. 「个人 agent」与「企业多 agent」的分水岭在于：本地优先存储、cron 心跳驱动的主动性、文件/SQLite 即可承载的记忆。OpenClaw（TypeScript，39 万 star）证明这条路线在个人场景成立（[openclaw/openclaw](https://github.com/openclaw/openclaw)）。
3. 间隔重复不需要自研算法：FSRS 有同行评议论文（KDD 2022）与官方 TS 实现 `ts-fsrs`，且已是 Anki 内建调度器（[fsrs4anki Wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki/Research-resources)、[Anki 手册 FSRS 章节](https://docs.ankiweb.net/deck-options.html#fsrs)）。
4. 词典/语料/分级/语音均有免费一手数据源：Free Dictionary API、kaikki.org（机器可读 Wiktionary）、Tatoeba（CC BY）、Jisho（非官方 API）、CEFR 官方文件、EVP/Oxford 3000、Web Speech API、LanguageTool。

---

## 2. TS Agent 框架对比

### 2.1 总览表（数据截至 2026-10-02）

| 框架 | 最新版本（npm 实测） | GitHub stars | 许可证 | 核心抽象 | MCP | 记忆/持久化 | 定时/主动 | 本地模型 |
|---|---|---|---|---|---|---|---|---|
| Vercel AI SDK | `ai@7.0.127`（2026-10-01） | 27,087 | Apache-2.0 | `ToolLoopAgent`、tool、`generateText/streamText`、UI hooks、`HarnessAgent` | 客户端（`@ai-sdk/mcp@2.0.66`，HTTP/SSE/stdio+OAuth） | ❌ 无内建（应用层自管） | ❌ 无内建 | ✅ 社区 provider（`ollama-ai-provider-v2`/`ai-sdk-ollama`） |
| Mastra | `@mastra/core@1.74.0`（2026-10-01） | 21,221 | Apache-2.0（核心）+ 企业版目录（`ee/`） | Agent、图工作流、Memory、Studio | ✅ 双向：`MCPClient` + `MCPServer`（MCP `2026-07-28`，stdio/Streamable HTTP，含 MCP Apps） | ✅ `@mastra/memory`（工作记忆/语义召回/Observational Memory）+ LibSQL 等存储 | ✅ `mastra.schedules`（持久化 cron、线程信号、生命周期钩子） | ✅ 经 AI SDK 的 Ollama provider |
| OpenAI Agents SDK (JS) | `@openai/agents@0.18.0`（2026-09-10，**仍为 0.x**） | 3,883 | MIT | Agent/Runner、function tools、handoffs、guardrails、sessions、Realtime（语音） | ✅ hosted MCP 工具 + Streamable HTTP + stdio | ✅ Session 接口（OpenAI 托管/内存/自定义，含 compaction） | ❌ 无内建 | ⚠️ 经 AI SDK 适配器或自定义 `ModelProvider` |
| LangChain.js / LangGraph.js | `langchain@1.5.15`（2026-10-01）/ `@langchain/langgraph@1.4.18`（2026-09-25） | 18,245 / 3,162 | MIT | `createAgent`（LangChain，构建于 LangGraph 之上）、`StateGraph` | ✅ `@langchain/mcp-adapters@2.0.0` | ✅ LangGraph checkpointer（含 `@langchain/langgraph-checkpoint-sqlite@1.0.4`） | ⚠️ 框架内无 cron（LangSmith Deployment 平台提供） | ✅ `@langchain/ollama@1.3.0` |
| VoltAgent | `@voltagent/core@2.11.0`（2026-09-28） | 10,712 | MIT | Agent、workflow chain、supervisor/sub-agents、Memory、Guardrails、Voice | ✅ 工具注册表 + MCP 集成 | ✅ Memory 适配器（LibSQL / Managed 等） | ✅ Triggers（含 cron），**但调度源配置在 VoltOps 平台** | ✅ 复用 AI SDK provider（同 Ollama 路径） |
| （参照）OpenClaw | `openclaw@2026.9.7`（2026-09-30） | 391,198 | MIT | 个人 agent 网关：频道接入 + 心跳/cron + 技能 + 文件记忆 | ✅ 支持 | ✅ 本地文件/SQLite（本机持有） | ✅ 内建 cron/心跳 | ✅ 本地模型可插拔 |

> 数据来源：`vercel/ai`、[mastra-ai/mastra](https://github.com/mastra-ai/mastra)、[openai/openai-agents-js](https://github.com/openai/openai-agents-js)、[VoltAgent/voltagent](https://github.com/VoltAgent/voltagent)、[langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs)、[langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs)、[openclaw/openclaw](https://github.com/openclaw/openclaw) 的 GitHub API 仓库元数据 + npm registry（`registry.npmjs.org/<pkg>` 的 `dist-tags.latest` 与发布时间）。

### 2.2 分框架依据

#### Vercel AI SDK

- 定位：「The TypeScript toolkit for building AI-powered applications and agents」，三个主要面：AI SDK Core（统一多 provider 生成/工具调用）、AI SDK UI（聊天 UI hooks）、Harnesses（`HarnessAgent` 复用 Claude Code/Codex/Pi 等外部 harness）（[AI SDK Introduction](https://ai-sdk.dev/docs/introduction)）。
- Agent 抽象：`ToolLoopAgent`——「LLM 在 loop 中使用 tools」；提供 `runtimeContext`/`toolsContext`、`stopWhen`、`prepareStep`；另有 `@ai-sdk/tui` 终端 UI（[AI SDK Agents 文档](https://ai-sdk.dev/docs/agents/overview)）。
- MCP：`createMCPClient`（`@ai-sdk/mcp`），支持 Streamable HTTP（生产推荐）/SSE/stdio（仅本地）/自定义 transport；支持 OAuth、工具 schema 显式声明、typed `structuredContent` 输出、以及 `fingerprintTools`/`detectToolDrift` 防「rug pull」工具定义漂移（[AI SDK MCP 文档](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)）。
- 本地模型：官方文档列出两个社区 Ollama provider（`ollama-ai-provider-v2`、`ai-sdk-ollama`），后者基于 Ollama 官方 JS 客户端并支持 embeddings（[AI SDK Ollama 文档](https://ai-sdk.dev/providers/community-providers/ollama)）。
- 注意：**没有内建的记忆、持久化、cron 抽象**——Agents 文档的上下文管理止步于 `runtimeContext` 与消息数组，会话存储需自建（同上两个文档页面均未提供记忆原语）。

#### Mastra

- 定位：「framework for building AI-powered applications and agents with a modern TypeScript stack」；亮点包括 40+ provider 模型路由、agents、图工作流（`.then()/.branch()/.parallel()`）、human-in-the-loop（挂起/恢复，状态入存储）、MCP servers、内建 evals 与可观测性（[Mastra GitHub README](https://github.com/mastra-ai/mastra)）。由 Gatsby 团队创建，核心 Apache-2.0，`ee/` 目录为企业许可（同上 README）。
- 记忆：`@mastra/memory` 提供消息历史、**Observational Memory**（后台 agent 把旧消息压缩成 observations，替代原始历史）、working memory（结构化用户数据）、semantic recall（语义检索）；存储须配 provider，官方默认 LibSQL（本地 SQLite 文件即可，如 `file:./mastra.db`）（[Mastra Memory 文档](https://mastra.ai/docs/memory/overview)）。
- 调度：`mastra.schedules` 为持久化 cron 的 CRUD 服务（`@mastra/core@1.50.0` 引入，当前标 beta），支持 threadless（独立 `agent.generate()`）与 threaded（向既有会话线程注入信号）两种触发模式、IANA 时区、`prepare/onFinish/onError/onAbort` 生命周期钩子，并可通过 `@mastra/client-js` 远程管理（[Mastra Schedules 文档](https://mastra.ai/docs/harness/schedules)）。
- MCP：双向。`MCPClient` 连接外部 server（静态 `listTools()` 或按请求 `listToolsets()`，支持按工具名/注解的 `requireToolApproval`、出站 host 白名单等安全项）；`MCPServer` 把 Mastra 的 agents/tools/workflows 暴露为 MCP（注册后挂在 `/api/mcp/:serverId/mcp`，Streamable HTTP），并支持 MCP Apps（工具附带 `ui://` 交互界面）（[Mastra MCP 文档](https://mastra.ai/docs/connections/mcp)）。
- 本地模型：官方 models 文档确认 Ollama「available through the AI SDK」（[Mastra Ollama provider 文档](https://mastra.ai/models/providers/ollama)）。
- 维护状态：`@mastra/core@1.74.0` 发布于 2026-10-01（npm registry）；GitHub commits API 显示 2026-10-02 当天仍有提交（如 `#25794`），仓库 PR 编号已超 25,000。

#### OpenAI Agents SDK (JS/TS)

- 定位：「lightweight yet powerful framework for building multi-agent workflows in JavaScript/TypeScript」，provider-agnostic；原语：Agents、Sandbox Agents（带文件系统工作区）、**Realtime Agents（低延迟语音，WebRTC）**、handoffs/agents-as-tools、guardrails、sessions、tracing（[openai-agents-js README](https://github.com/openai/openai-agents-js)）。
- 记忆：Session 接口——runner 每轮自动取出历史、结束后持久化；内建 `OpenAIConversationsSession`（OpenAI 托管）与 `MemorySession`（本地开发）；可用 5 个异步方法自实现 SQLite/Redis 等后端；另有 `OpenAIResponsesCompactionSession` 自动压缩长历史（[Sessions 文档](https://openai.github.io/openai-agents-js/guides/sessions/)）。
- MCP：三种方式——hosted MCP 工具（OpenAI Responses API 直接调用远端 server，支持 `requireApproval` 审批流）、`MCPServerStreamableHttp`、`MCPServerStdio`；支持工具过滤、名称前缀、工具列表缓存（[MCP 文档](https://openai.github.io/openai-agents-js/guides/mcp/)）。
- 模型：默认走 OpenAI；非 OpenAI 模型可实现 `ModelProvider`/`Model` 接口，或「Using any model with Vercel's AI SDK」适配器直接接入 AI SDK 生态（含 Ollama 路径）（[Models 文档](https://openai.github.io/openai-agents-js/guides/models/)）。
- 对语言学习的独特点：Realtime 语音 agent 是一等公民（浏览器 WebRTC 直连麦克风），做口语陪练时几乎是开箱即用的路径（[README](https://github.com/openai/openai-agents-js)）。
- 注意：截至 2026-10-02 最新版 `@openai/agents@0.18.0`，**尚未发布 1.0**，API 稳定性风险需留意（npm registry）。

#### LangChain.js / LangGraph.js

- 分层：LangChain（`createAgent` + middleware 的可配置 harness）→ 构建于 LangGraph 之上（durable execution、persistence、human-in-the-loop、记忆）；LangGraph 是低层编排框架（`StateGraph`），「mix deterministic and agentic steps」（[LangChain JS Overview](https://docs.langchain.com/oss/javascript/langchain/overview)、[LangGraph JS Overview](https://docs.langchain.com/oss/javascript/langgraph/overview)）。
- MCP/本地模型：`@langchain/mcp-adapters@2.0.0`（2026-10-01）、`@langchain/ollama@1.3.0`（npm registry 实测）。
- 持久化：checkpointer 机制，`@langchain/langgraph-checkpoint-sqlite@1.0.4` 可本地落 SQLite（npm registry）。
- 定位判断：能力最全但抽象层最多；对「个人 agent」而言偏重，更适合需要复杂可控编排（而非简单工具循环）的场景。

#### VoltAgent

- 定位：「AI Agent Engineering Platform」= 开源 TS 框架 + VoltOps Console（可观测/自动化/部署）。框架内建 Memory、RAG、Guardrails、Tools、MCP、Voice（OpenAI/ElevenLabs TTS/STT）、Workflow（支持 suspend/resume 的人工介入）、supervisor 多 agent（[VoltAgent GitHub README](https://github.com/VoltAgent/voltagent)）。
- 记忆：`Memory` 类 + 适配器（`LibSQLMemoryAdapter` 本地 SQLite 文件、`ManagedMemoryAdapter`），支持语义搜索与 working memory（[VoltAgent Memory 文档](https://voltagent.dev/docs/agents/memory/)）。
- 触发器：`createTriggers` 在框架侧接收事件；触发源覆盖 Slack/Gmail/Airtable/GitHub/**cron**，但 cron 等触发源在 **VoltOps 控制台**配置（「Navigate to the VoltOps Triggers page」），即调度基础设施依赖其平台（可自托管），纯本地 cron 需自建（[Triggers Overview](https://voltagent.dev/actions-triggers-docs/triggers/overview/)、[Cron Trigger](https://voltagent.dev/actions-triggers-docs/triggers/cron/)）。
- 适合看重「可视化调试/追踪」的开发者；模型层复用 AI SDK provider（README 示例即 `@ai-sdk/openai`），因此 Ollama 路径与 AI SDK 相同。

#### 其他活跃框架（简述）

- **Cloudflare Agents SDK**（`cloudflare/agents`，5,712 stars，MIT，2026-10-02 仍有推送）：面向 Cloudflare Workers/Durable Objects 的有状态 agent 运行时，适合把个人 agent 部署到边缘（GitHub API）。
- **CopilotKit**（37,674 stars，MIT）：「Frontend Stack for Agents」，AG-UI 协议发起者——做 agent 前端/人机协同界面时可与上述后端框架组合（GitHub API）。
- **OpenClaw**（391,198 stars，MIT，OpenClaw Foundation 治理）：严格说不是框架而是「个人 agent 网关」成品，但其架构（本地持有状态/记忆/凭证、模型与 harness 可插拔、频道接入、cron 心跳、技能文件）是本课题最直接的对照实现（[OpenClaw README](https://github.com/openclaw/openclaw)）。

---

## 3. 个人 Agent 架构模式要点

1. **工具调用循环是核心，工作流做兜底。** Anthropic 的工程指南把「augmented LLM」（LLM + 检索/工具/记忆）列为所有 agentic 系统的基本构件，并明确建议「从最简单的方案开始，只在需要时增加复杂度」；workflows（预定义代码路径）用于确定性任务，agents（LLM 自主驱动）用于开放任务（[Anthropic: Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)）。对个人语言学习 agent：对话/纠错走 agent 循环；「每日生成复习清单」这类任务走确定性 workflow 更稳。
2. **记忆分三层落地**：会话历史（谁都会做）+ 结构化长期画像（用户水平、目标、弱点，对应 Mastra working memory / 自定义表）+ 语义检索（embeddings + 向量库）。本地场景下 `sqlite-vec`（纯 C、零依赖的 SQLite 向量检索扩展，有 Node.js 绑定，Mozilla Builders 项目）可让向量检索与业务数据同库（[sqlite-vec 仓库](https://github.com/asg017/sqlite-vec)）。
3. **MCP 是扩展机制的标准答案，但进程内插件更简单。** MCP 官方定位是「AI 应用的 USB-C 端口」，连接数据源/工具/工作流，生态内客户端众多（[MCP 官方介绍](https://modelcontextprotocol.io/docs/getting-started/intro)）。代价是跨进程边界：序列化开销、生命周期管理、安全面（AI SDK 与 Mastra 的文档都专门讨论了工具审批、rug pull 检测、出站限制）。个人项目经验法则：**自己写的工具先进程内；需要被别的 MCP 客户端（Claude Desktop 等）复用、或要接第三方现成 server 时，再走 MCP**。
4. **主动性 = cron 心跳 + 事件。** 语言学习尤其依赖主动触达（「该复习了」）。框架侧：Mastra `mastra.schedules` 支持持久化 cron 并向既有会话线程注入信号（[Mastra Schedules](https://mastra.ai/docs/harness/schedules)）；VoltAgent triggers 支持 cron（调度源在 VoltOps）（[VoltAgent Cron Trigger](https://voltagent.dev/actions-triggers-docs/triggers/cron/)）；产品侧 OpenClaw 证明了「心跳 + 消息频道」是个人 agent 的主流形态（[OpenClaw README](https://github.com/openclaw/openclaw)）。
5. **本地优先（local-first）。** Ink & Switch 的原始论文主张数据所有权回归本地（「old-fashioned apps give us ownership」），个人 agent 的记忆与学习数据高度隐私，SQLite 单文件 + 可选同步是 2026 年的默认解（[Local-first software 论文](https://www.inkandswitch.com/local-first/)）。OpenClaw 的设计宣言「State, memory, and credentials live on your hardware」与此一致（[OpenClaw README](https://github.com/openclaw/openclaw)）。

---

## 4. 语言学习模块：功能域拆解 + 可用库/数据源

### 4.1 间隔重复（SRS）

- **FSRS（Free Spaced Repetition Scheduler）**：源自 MaiMemo，论文《A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling》发表于 ACM KDD 2022（Ye, Su, Cao；DOI: 10.1145/3534678.3539086），另有 IEEE TKDE 后续论文；官方同时开源了带时序特征的间隔重复数据集（FSRS-Anki-20k、anki-revlogs-10k）（[fsrs4anki Wiki: Research resources](https://github.com/open-spaced-repetition/fsrs4anki/wiki/Research-resources)）。
- **TS 实现 `ts-fsrs`**：`ts-fsrs@5.4.2`（MIT，2026-09-01 发布）为调度器（`createEmptyCard` / `fsrs()` / `repeat` / `next` / `Rating`），同仓 `@open-spaced-repetition/binding@0.5.0` 负责从复习日志训练个性化参数；要求 Node ≥ 20（[ts-fsrs 仓库](https://github.com/open-spaced-repetition/ts-fsrs)，npm registry 实测版本）。
- **与 Anki 生态的关系**：FSRS 自 Anki 23.10 起内建于 Anki/AnkiMobile/AnkiWeb（AnkiDroid 2.17+）；Anki 手册给出官方使用约定——默认目标记忆保持率（desired retention）90%、不建议超过 97%、（再）学习步长应短于 1 天、参数约每月优化一次即可（[Anki 手册 Deck Options → FSRS](https://docs.ankiweb.net/deck-options.html#fsrs)）。这些约定可直接照搬到自建 SRS。
- **接入 Anki 的两条路径**：AnkiConnect 是 Anki 官方生态的标准本地 HTTP 插件（`localhost:8765`，JSON `{action, version, params}` 协议，Yomichan 等即通过它通信）（[AnkiConnect 官方文档](https://git.sr.ht/~foosoft/anki-connect)）；其上有现成 MCP server，如 `ankimcp/anki-mcp-server`（MIT，beta，53 个工具：复习、卡组/笔记/标签/媒体管理、统计；支持 stdio/Streamable HTTP/隧道，带只读模式与安全校验）（[anki-mcp-server 仓库](https://github.com/ankimcp/anki-mcp-server)）。

### 4.2 词汇/语法分级（CEFR）

- **CEFR 本体**：欧洲委员会《CEFR Companion Volume》（2020，ISBN 978-92-871-8621-8）为现行官方版本，定义 A1–C2 六个共同参考级别与「can do」描述符体系（[CEFR Companion Volume 官方 PDF](https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4)）。
- **英语词汇分级**：English Vocabulary Profile（EVP）给出单词/短语在各 CEFR 级别的掌握情况（[EVP 官方页](https://englishprofile.org/?menu=english-vocabulary-profile)）；Oxford 3000/5000 词表亦按 CEFR 标注（[Oxford Learner's Dictionaries wordlists](https://www.oxfordlearnersdictionaries.com/wordlists/oxford3000-5000)，该 URL 经二手来源转引，未直接抓取验证，见文末说明）。
- **语法纠错**：LanguageTool 提供免费 HTTP API（免费档 20 请求/分钟、75,000 字符/分钟、单请求 20,000 字符），覆盖语法与风格检查，可自托管（[LanguageTool HTTP API 文档](https://languagetool.org/http-api/)）。

### 4.3 词典与语料

| 资源 | 内容 | 许可/形态 | 来源 |
|---|---|---|---|
| Free Dictionary API | 英语词条：音标、发音音频 URL、词性、释义、例句、同/反义词 | 免费 REST（`api.dictionaryapi.dev/api/v2/entries/en/<word>`） | [dictionaryapi.dev](https://dictionaryapi.dev) |
| kaikki.org (Wiktextract) | 从 Wiktionary 提取的机器可读词典：覆盖英/西/法/德/中/日/韩等数十语言，JSON 可下载 | 机器可读数据集（基于 Wiktionary；学术引用要求见站内） | [kaikki.org](https://kaikki.org) |
| Tatoeba | 海量例句及跨语言翻译对，含部分音频；每周导出，可按语言对定制导出 | CC BY 2.0 FR（部分 CC0）；音频许可由贡献者指定 | [Tatoeba Downloads](https://tatoeba.org/downloads) |
| Jisho | 日英词典搜索（词条、JLPT 标签等） | **非官方/未文档化 API**（`jisho.org/api/v1/search/words?keyword=...`），作者原话「alpha inside a beta」，无稳定性保证 | [Jisho 官方论坛帖](https://jisho.org/forum/54fefc1f6e73340b1f160000-is-there-any-kind-of-search-api) |

### 4.4 发音与语音

- **Web Speech API**（浏览器内）：`SpeechRecognition`（ASR，可用平台服务或浏览器本地识别）+ `SpeechSynthesis`（TTS，`SpeechSynthesisUtterance` 控制语言/音高/音量）；注意浏览器兼容性差异，适合 Web 前端的零成本发音/听写功能（[MDN: Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)）。
- **框架侧语音**：OpenAI Agents SDK 的 Realtime Agents 走 WebRTC 低延迟语音对话（含打断检测、会话历史），适合口语陪练场景（[openai-agents-js README](https://github.com/openai/openai-agents-js)）；VoltAgent 的 Voice 模块支持 OpenAI/ElevenLabs 及自定义 TTS/STT provider（[VoltAgent README](https://github.com/VoltAgent/voltagent)）。

### 4.5 LLM 对话练习、纠错与进度评估

- 对话练习/纠错本质是 prompt + 结构化输出问题，各框架的 `tool` + 结构化输出（如 AI SDK 的 `generateObject` 路径、各家的 output schema）即可实现「返回纠错列表 + 改写 + 解释」；语法级确定性检查可用 LanguageTool 打底、LLM 做语用层补充（[LanguageTool HTTP API](https://languagetool.org/http-api/)）。
- 进度评估建议落到**数据**而非纯模型判断：FSRS 的复习日志天然给出每个知识点的 retrievability/stability 时间序列（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)），再叠加 CEFR 描述符做能力映射（[CEFR Companion Volume](https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4)）；Mastra 的 evals/observability 可用于回归评估 agent 的教学行为质量（[Mastra README](https://github.com/mastra-ai/mastra)）。

---

## 5. 集成方案对比与推荐

### 5.1 三种形态对比

| 维度 | A. 独立 MCP server | B. 进程内工具集 | C. 混合（推荐） |
|---|---|---|---|
| 调用开销 | 跨进程（stdio/HTTP），有序列化与进程生命周期成本 | 函数调用，零开销 | 热路径进程内，外部复用走 MCP |
| 类型安全/可测试性 | schema 边界，类型在边界处弱化 | 完全类型化（zod schema 即工具定义） | 同 B，MCP 层自动从同一定义生成 |
| 生态复用 | 任何 MCP 客户端可用（Claude Desktop、Cursor 等） | 仅本 agent | 两者兼得 |
| 部署/运维 | 多一个进程 | 单进程 | 单进程起步，需要时再开 server |
| 安全面 | 需考虑工具审批、rug pull、出站限制（各框架文档均强调） | 最小 | 进程内默认可信，MCP 暴露面按需 |
| 框架支持 | Mastra `MCPServer` 一行暴露 agents/tools/workflows；AI SDK/Mastra/OpenAI SDK/LangChain 均有 MCP 客户端 | 所有框架原生 | Mastra 对该模式支持最直接 |

依据：[Mastra MCP 文档](https://mastra.ai/docs/connections/mcp)、[AI SDK MCP 文档](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)、[OpenAI Agents JS MCP 文档](https://openai.github.io/openai-agents-js/guides/mcp/)、[MCP 官方介绍](https://modelcontextprotocol.io/docs/getting-started/intro)。

### 5.2 推荐架构（C 方案展开）

1. **内核是一个与框架无关的 TS 包**（如 `packages/lingua-core`）：领域模型（词卡、CEFR 级别、复习日志）+ ts-fsrs 调度 + 数据源客户端（Dictionary API/kaikki/Tatoeba）+ LanguageTool 检查。纯函数、可单测。
2. **agent 侧把内核包成进程内工具**：Mastra `createTool` / AI SDK `tool()`，zod 定义输入输出。工具示例：`get_due_cards`、`record_review(rating)`、`add_word(lemma)`、`lookup_dictionary`、`generate_drill(topic, cefr_level)`、`correct_utterance(text)`。
3. **存储**：单个 SQLite 文件。选 Mastra 则直接用其 LibSQL 存储承载记忆，业务表与 `sqlite-vec` 向量表放同库；语种画像（当前 CEFR 自评、目标、每日新词上限）走结构化表，不进向量库（[sqlite-vec](https://github.com/asg017/sqlite-vec)、[Mastra Memory 文档](https://mastra.ai/docs/memory/overview)）。
4. **主动性**：`mastra.schedules` 建每日 cron（如 `0 9 * * *`），threaded 模式向用户既有线程发「今日复习 N 张卡」信号——这是 FSRS 到期队列 + cron 心跳的直接组合（[Mastra Schedules](https://mastra.ai/docs/harness/schedules)）。
5. **对外暴露（可选）**：同一批工具注册进 Mastra `MCPServer`，即得 stdio/Streamable HTTP 双形态的 MCP server，供其他 MCP 客户端复用（[Mastra MCP 文档](https://mastra.ai/docs/connections/mcp)）。
6. **Anki 兼容策略**：若目标用户已用 Anki，优先通过 AnkiConnect / anki-mcp-server 读写 Anki（FSRS 调度交给 Anki），agent 专注对话与内容生成；自建 SRS 仅在「无 Anki 依赖」场景启用（[AnkiConnect](https://git.sr.ht/~foosoft/anki-connect)、[anki-mcp-server](https://github.com/ankimcp/anki-mcp-server)）。

---

## 6. 参考来源列表

**框架**
- Vercel AI SDK — https://ai-sdk.dev/docs/introduction ；Agents — https://ai-sdk.dev/docs/agents/overview ；MCP — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools ；Ollama — https://ai-sdk.dev/providers/community-providers/ollama ；仓库 https://github.com/vercel/ai
- Mastra — 仓库 https://github.com/mastra-ai/mastra ；文档首页 https://mastra.ai/en/docs ；MCP — https://mastra.ai/docs/connections/mcp ；Memory — https://mastra.ai/docs/memory/overview ；Schedules — https://mastra.ai/docs/harness/schedules ；Ollama provider — https://mastra.ai/models/providers/ollama
- OpenAI Agents SDK (JS) — 仓库 https://github.com/openai/openai-agents-js ；文档 https://openai.github.io/openai-agents-js/ ；MCP — https://openai.github.io/openai-agents-js/guides/mcp/ ；Sessions — https://openai.github.io/openai-agents-js/guides/sessions/ ；Models — https://openai.github.io/openai-agents-js/guides/models/
- LangChain.js — https://docs.langchain.com/oss/javascript/langchain/overview ；LangGraph.js — https://docs.langchain.com/oss/javascript/langgraph/overview ；仓库 https://github.com/langchain-ai/langchainjs 、https://github.com/langchain-ai/langgraphjs
- VoltAgent — 仓库 https://github.com/VoltAgent/voltagent ；Memory — https://voltagent.dev/docs/agents/memory/ ；Triggers — https://voltagent.dev/actions-triggers-docs/triggers/overview/ ；Cron — https://voltagent.dev/actions-triggers-docs/triggers/cron/
- Cloudflare Agents — https://github.com/cloudflare/agents ；CopilotKit — https://github.com/CopilotKit/CopilotKit ；OpenClaw — https://github.com/openclaw/openclaw
- npm registry（版本与发布时间）：https://registry.npmjs.org/ （ai、@mastra/core、@mastra/mcp、@mastra/memory、@mastra/libsql、@openai/agents、@voltagent/core、@voltagent/voltagent-memory、langchain、@langchain/langgraph、@langchain/mcp-adapters、@langchain/ollama、@langchain/langgraph-checkpoint-sqlite、ts-fsrs、@open-spaced-repetition/binding、openclaw）

**架构模式**
- Anthropic《Building effective agents》— https://www.anthropic.com/engineering/building-effective-agents
- MCP 官方介绍 — https://modelcontextprotocol.io/docs/getting-started/intro
- Ink & Switch《Local-first software》— https://www.inkandswitch.com/local-first/
- sqlite-vec — https://github.com/asg017/sqlite-vec

**语言学习**
- FSRS 论文/研究资源索引 — https://github.com/open-spaced-repetition/fsrs4anki/wiki/Research-resources （论文 DOI: 10.1145/3534678.3539086，KDD 2022）
- ts-fsrs — https://github.com/open-spaced-repetition/ts-fsrs
- Anki 手册 FSRS 章节 — https://docs.ankiweb.net/deck-options.html#fsrs
- AnkiConnect — https://git.sr.ht/~foosoft/anki-connect
- anki-mcp-server — https://github.com/ankimcp/anki-mcp-server
- CEFR Companion Volume（Council of Europe, 2020）— https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4
- English Vocabulary Profile — https://englishprofile.org/?menu=english-vocabulary-profile
- Free Dictionary API — https://dictionaryapi.dev
- kaikki.org — https://kaikki.org
- Tatoeba Downloads — https://tatoeba.org/downloads
- Jisho API（官方论坛说明）— https://jisho.org/forum/54fefc1f6e73340b1f160000-is-there-any-kind-of-search-api
- Web Speech API（MDN）— https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- LanguageTool HTTP API — https://languagetool.org/http-api/

---

## 附：未能核实 / 不确定项

1. **FSRS 论文 ACM 页面**（dl.acm.org/doi/10.1145/3534678.3539086）对抓取返回 403；论文题录信息经 fsrs4anki 官方 Wiki 与多篇引用该文的论文交叉确认，DOI 链接本身为规范入口但未直接读全文。
2. **欧洲委员会 CEFR 主站**（coe.int）对抓取返回 403；改用其官方 PDF 域名 rm.coe.int 上的《CEFR Companion Volume》原文核实。
3. **Oxford 3000/5000 词表 URL** 来自 StackExchange 回答转引（二手），未直接抓取验证。
4. **Jisho API** 为官方人员发布但自称未文档化、无稳定性承诺的接口，生产使用需自负风险（已按一手论坛原文标注）。
5. **VoltAgent cron**：cron 触发源的调度运行在 VoltOps 平台侧（可云可自托管），OSS 框架本体负责接收投递；若要求完全无平台依赖的本地 cron，需自建（如 `node-cron`）或改用 Mastra schedules。
6. **AI SDK 大版本发布日期**（如 v7 的确切发布日）未从官方公告核实；报告中版本信息一律以 npm registry 的发布时间与 GitHub releases 页为准。
7. GitHub 仓库 API 中 Mastra 的 `pushed_at` 一度返回 2026-02-20（疑似缓存），已用 commits API 复核：2026-10-02 当日有多次提交，维护活跃。
