# Bootstrap 课包

系统为零基础语言准备的策展内容源（GLOSSARY「Bootstrap 课包」），按序推送到
系统会话，复用「推送 → 预学 → 好友角色埋伏使用」闭环。

## 文件

- `en-bootstrap-a1.json` — 英语零基础首批课包（5 课：高频生存语块 ×2、
  基础句构 ×1、A1 分级短文 ×2；共 24 个语块）。面向中文母语、对 AI agent
  感兴趣的零基础学习者。

格式由 `@lingua/core` 的 `parseBootstrapPack` 校验：每课含标题、课型
（`survival-chunks` / `sentence-patterns` / `graded-text`）、一句
「为什么你会感兴趣」钩子、正文与预学清单；每条语块只给第一层解释
（例句 + 一句直觉规律，ADR-0005），类型限 `collocation` / `idiom`（v1）。

## 许可

本目录内容为「内容」而非代码，以 **CC BY 4.0** 发布（见仓库根目录
`LICENSE-CONTENT`）。署名：Lingua 项目。

## 来源与校验（2026-10-03）

内容为 AI 起草 + 人工对照一手来源校验，**不复制任何第三方词表**：

- 主要依据 **Cambridge A2 Key Vocabulary List**（Cambridge University
  Press & Assessment 2023，官方词汇表，义项级别介于 A1–B2）：以下语块或其
  核心义项在表中直接出现，故定级 ≤A2 有依据——`excuse me`、`never mind`
  （另经 Cambridge Dictionary 标注 A2）、`for example`、`by the way`、
  `of course`、`it doesn't matter`（matter 动词义）、`could you`（could
  情态动词请求义）、`look for`、`find out`、`turn on`、`make sure`、
  `it takes`（take 花费义）、`a lot of`、`let me`（let 动词义），以及
  分级短文所用科技词汇（app、blog、download、link、online、software 等）。
- `how's it going`：非正式见面寒暄，初学者教材固定单元（COBUILD
  疑问句手册、Longman DAE 口语条、EnglishClass101 Beginner S1），定 A2。
- `nice to meet you` / `thanks a lot` / `see you around` / `have fun` /
  `I like` / `I want to` / `I need to` / `there is`：A1 功能意念教学
  通则中的问候、介绍、道谢与自我表达句构，定 A1–A2。
- **刻意排除**：EVP 显示 `day by day` / `little by little` / `pick up`
  （学会义）等到 B1–B2 才被学习者稳定掌握，本包不用，保持 A1–A2 坡度。
- **EFLLex 词表为 CC BY-NC-SA，不随本仓库分发**（难度管道由下载脚本在
  本地获取）；本包定级未复制 EFLLex 数据，仅作上述公开来源抽查。

定级是「教学上合理的保守标注」，不是精确测量：预学机制的设计目的就是
桥接 i+1 落差。
