# Lingua

> 一个个人语言学习 agent：把预学和复习藏进你感兴趣的真实内容，和一个好友角色的日常对话里。

A personal language-learning agent that hides pre-learning and review inside content you actually care about, and conversations with a companion who shares your interests.

**状态：设计完成，施工中（MVP）**。目前仓库里最有价值的不是代码，而是整套有据可查的设计过程：

- [GLOSSARY.md](GLOSSARY.md) — 领域词汇表（25 个术语）
- [docs/specs/mvp.md](docs/specs/mvp.md) — MVP 规格（40 个用户故事 + 四轮设计审查修订）
- [docs/adr/](docs/adr/) — 17 份架构决策记录
- [docs/research/](docs/research/) — 7 份研究报告（二语习得、学习者建模、对话式学习等，约 200 条带 DOI 引用）

## 它有什么不同

- **不做打卡式复习**：复习 = 主动回忆，藏在内容复现与角色的"埋伏式话题"里
- **学习状态是算出来的**：append-only 事件流 + FSRS/PFA，可重放、可审计；LLM 只做传感器，不做记忆
- **双联系人 IM**：系统（订阅/推送/小结，无人格）与好友角色（关系与对话，不承担教学工具性）
- **讲解有护栏**：结构化语言学知识条目约束生成，三层呈现，默认只给"例句 + 一句直觉规律"

## 许可

双许可：**代码 MIT**（见 [LICENSE](LICENSE)）；**内容 CC BY 4.0**（见 [LICENSE-CONTENT](LICENSE-CONTENT)，含课包、知识条目、研究与设计文档）。

## Quickstart

要求 Node.js ≥ 24（内置 `node:sqlite`）与 pnpm。

```bash
pnpm install
pnpm typecheck   # 全部包 tsc --noEmit
pnpm test        # 全部测试（假时钟驱动，无真实等待）+ Web Chat 假模型 e2e 冒烟
pnpm lingua init # 初始化数据目录与 SQLite schema（默认 ~/.lingua/，可用 LINGUA_DATA_DIR 覆盖）
```

## Web Chat（MVP）

IM 界面里有两个联系人：**系统**（纯工具文案，无人格）与**好友角色**（默认 Maya，网聊风格英语朋友）。

```bash
pnpm lingua init        # 生成数据目录、schema 与 config.toml 模板（填入 [models.main] 的 api_key，如 DeepSeek key）
pnpm lingua serve       # 启动 Web Chat，默认 http://localhost:3939（--port 可改）
```

- 配置查找顺序：`LINGUA_CONFIG` 环境变量 → `./config.toml` → 数据目录下的 `config.toml`（`lingua init` 生成处，默认 `~/.lingua/`）；config.toml 已 gitignore，永不入库。
- 消息持久化在数据目录的 SQLite（schema v4 起含 `messages` 表），重启不丢。
- A1–A2 支架档（默认）：角色每条英文消息附**可展开中文翻译**（点开「中文翻译」即读）；档位规则在 lingua-core（`scaffoldingPolicy`），B1 及以上不附翻译。
- 角色卡：首次启动把内置默认卡写入数据库；把自定义卡片 JSON 放到 `~/.lingua/companion.json` 即可在下个全新数据目录生效（字段见 `apps/shell/cards/default-companion.json`：人格基底 + 兴趣层 + 母语支架档位 + 语域范围 + 语言对）。

**手工验收（需要真实 API key）**：按上文配置 DeepSeek key → `pnpm lingua serve` → 浏览器打开 → 与好友角色完成一轮对话，确认：回复到达且消息刷新后仍在（持久化）；角色消息下方有「中文翻译」折叠条；切到系统会话，存在欢迎文案且任何输入只得到固定工具文案。无 key 环境下 `pnpm --filter @lingua/shell smoke` 以假模型跑通同一条链路（工具循环、翻译拆分、跨重启持久化）。

## 仓库结构

- `packages/lingua-core` — 框架无关的领域包：append-only 事件存储（窄写入接口 `recordEvidence`，ADR-0014）、有效观测解析管线、as-of 双模式投影（当时所知 / 当前认知）、三段式 digest、角色卡与策展事实、母语支架档位规则、双联系人消息存储、SQLite schema v3、时钟端口（含 ID 生成，可注入假时钟）
- `apps/shell` — 薄壳：CLI（`init` / `serve`）、Web Chat（node:http + 无构建原生前端）、agent loop（Vercel AI SDK 工具循环，直连无渠道抽象层）、TOML 配置加载、角色卡装配
- `docs/` — 规格、ADR、研究报告
