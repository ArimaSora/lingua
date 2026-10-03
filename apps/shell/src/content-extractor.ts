import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { ContentExtractor } from "@lingua/core";

// 正文抓取适配器（issue #10）：Readability 是 Firefox Reader View 的提取算法，
// 对新闻/博客类 HTML 的正文、标题、作者、日期提取最稳；jsdom 提供所需 DOM。
// 这是最小可靠方案：比正则/cheerio 重一点，但远低于自己维护一套 heuristics。

export function createReadabilityExtractor(): ContentExtractor {
  return async (url: string) => {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`抓取失败：${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article) {
      throw new Error("无法从页面提取正文");
    }
    const body = article.textContent;
    if (!body || body.trim().length === 0) {
      throw new Error("提取正文为空");
    }
    return {
      title: article.title ?? undefined,
      body,
      publishedAt: article.publishedTime ? Date.parse(article.publishedTime) : undefined,
    };
  };
}
