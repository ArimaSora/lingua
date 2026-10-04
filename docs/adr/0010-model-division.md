---
status: accepted
---

# 模型分工：DeepSeek 对话 / Jev 判分 / 混元 lite 轻量任务

**Jev 早期访问已获得**（2026-10-03），为主判分适配器；效果不达标时降级 Qwen-flash，配置级切换。

- **主模型 DeepSeek**：角色对话、讲解、话题生成（生成质量敏感）。
- **判分器 Jev**（TypeSafe System One 模型，早期访问已获得）：传感器判分——输出结构化判断 + 校准置信度，70–500ms、输出免费、schema 保证无类型错误；置信度低于阈值的结果保留观测、仅标记 applied=false 不参与状态更新（ADR-0014），防污染的同时保留重估可能。**藏在 Judge 接口后**：语块命中判定用确定性规则（词形还原+字符串匹配），Jev 只判用法正误；效果不达标时降级回 Qwen-flash 级 LLM 判分，配置级切换。残余风险：单一供应商初创、评测均为自发布数据。
- **轻量任务 混元 lite**（长期免费、OpenAI 兼容、并发≈5）：记忆门控、错误归并等批量粗活。注意：2026-09/10 来源对其在新 TokenHub 平台的可用性信号冲突，搭建时以官方控制台实测为准，失败即换 Qwen-flash。

所有模型走 OpenAI 兼容配置项（Jev 除外，其 API 形态不同，单独适配器）。

---

## 实现状态附注（issue #17，2026-10）

Jev 判分适配器已落地：`packages/lingua-core/src/jev-judge.ts`（协议组装/解析、
降级组合、判分配置解析规则）+ `apps/shell/src/jev-transport.ts`（HTTP 薄壳）。
调研确认（公开资料交叉验证）：Jev 是**决策模型**而非文本模型——不支持
chat/completions；官方直连 `POST https://api.typesafe.ai/v1/systemone`，请求
`{model, state, questions}`，问题类型 `noul`（是/否概率）/`choice`/`score`，
响应 `{model, answers, usage}`；OpenRouter 镜像走 `/api/alpha/decisions` 同一
协议。适配器只问一个 noul 问题（用法是否正确），概率 ≥0.5 → correct（置信度
= 概率），否则 wrong（置信度 = 补概率）；非 2xx / 超时 / 响应缺字段一律 throw，
由 `createFallbackUsageJudge` 降级到 LLM 判分（`[models.judge_fallback]` 缺省 =
主模型兼任）。配置切换：`[models.judge] provider = "jev" | <OpenAI 兼容 provider>`，
整段缺省 = 纯 LLM（Jev 需单独 early-access key，不静默默认）。
