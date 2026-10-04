import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { Cefr } from "@lingua/core";
import type { ContentSimplifier } from "@lingua/core";

// LLM 改写适配器（issue #10）：把易腐难文改写到目标 CEFR 级别，
// 保留核心信息并标注「简化版」+ 原文链接。无 key 或模型失败时抛错，
// 由 content-pipeline 捕获并降级为解锁队列。

export function createMainSimplifier(model: LanguageModel): ContentSimplifier {
  return async ({ title, body, url, targetLevel }) => {
    const prompt = [
      `Rewrite the following article so it is readable at CEFR ${targetLevel} for a Chinese speaker learning English.`,
      "Keep the key information, but use short sentences and simple words.",
      "Start the title with 「简化版」. End with a line 「原文链接：」 followed by the URL.",
      "",
      `Title: ${title ?? "Article"}`,
      "",
      body,
      "",
      `URL: ${url}`,
    ].join("\n");

    const result = await generateText({ model, system: prompt, messages: [] });
    const lines = result.text.trim().split("\n");
    const simplifiedTitle = lines[0] ?? `${title ?? "Article"}（简化版）`;
    const simplifiedBody = lines.slice(1).join("\n").trim();
    return {
      title: simplifiedTitle,
      body: simplifiedBody,
    };
  };
}
