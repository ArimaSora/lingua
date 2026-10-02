---
status: accepted
---

# 自研薄壳 + 框架无关内核，不采用 Mastra

需要一个 TypeScript agent 运行时承载对话循环、调度与工具调用。决定：内核（`lingua-core`）为框架无关纯 TS 包，壳自研，不采用 Mastra 等全栈框架。原因：本项目的状态架构（计算式学习者状态 + curated 关系记忆 + ≤300 token digest 注入）与框架自带的记忆抽象冲突，用 Mastra 意味着买下其最大组件却弃用并对抗它；差异化功能（埋伏式复习、语域控制、母语支架渐退）在任何框架里都需定制。LLM IO（Vercel AI SDK 作库）、MCP（官方 SDK）、调度、存储均有独立库可拼。若未来需要重工作流/evals 平台，再引入 Mastra，迁移成本仅限壳层。
