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
pnpm test        # 全部测试（假时钟驱动，无真实等待）
pnpm lingua init # 初始化数据目录与 SQLite schema（默认 ~/.lingua/，可用 LINGUA_DATA_DIR 覆盖）
```

## 仓库结构

- `packages/lingua-core` — 框架无关的领域包：append-only 事件存储（窄写入接口 `recordEvidence`，ADR-0014）、有效观测解析管线、as-of 双模式投影（当时所知 / 当前认知）、SQLite schema v1、时钟端口（含 ID 生成，可注入假时钟）
- `apps/shell` — 薄壳 CLI（agent loop、渠道、适配器随后续票据加入）
- `docs/` — 规格、ADR、研究报告
