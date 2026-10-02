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

施工中。第一张施工票据完成后更新。
