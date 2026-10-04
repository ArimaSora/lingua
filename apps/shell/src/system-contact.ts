// 系统联系人（ADR-0008）：扮演软件本身，纯工具文案无人格。
// 票 06 起承担 Bootstrap 课包预学完成的确认入口；订阅管理/小结属后续票据，
// 其余回复为固定文案，不经过任何模型。

import type { Bootstrap, ContentPipeline, RssSubscriptions } from "@lingua/core";

export const SYSTEM_CONTACT_NAME = "系统";

export const SYSTEM_WELCOME =
  "系统已上线。我负责订阅管理、内容推送与学习小结。回复「订阅 <URL>」添加 RSS/播客源，「列出订阅」查看全部，「取消订阅 <URL>」删除。日常对话请找好友角色。";

const URL_RE = /https?:\/\/[^\s]+/;

function findUrl(text: string): string | null {
  const match = URL_RE.exec(text);
  return match ? match[0] : null;
}

export function systemReply(_userText: string): string {
  return (
    "已收到。系统工具：回复「订阅 <URL>」添加 RSS/播客源，「列出订阅」查看全部，" +
    "「取消订阅 <URL>」删除。练习对话请切换到好友角色。"
  );
}

// 预学完成意图（issue #6）：推送的课附带指引「预学完成后回复 完成」。
function isPrelearningDone(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.includes("完成") || normalized.includes("学完") || normalized === "done"
  );
}

function isAddSubscriptionIntent(text: string): boolean {
  return /订阅|添加源|添加订阅/.test(text);
}

function isRemoveSubscriptionIntent(text: string): boolean {
  return /取消订阅|删除源|移除订阅/.test(text);
}

function isListSubscriptionsIntent(text: string): boolean {
  return /列出订阅|订阅列表/.test(text);
}

function addSubscriptionReply(rss: RssSubscriptions, text: string): string {
  const url = findUrl(text);
  if (!url) return "请提供要订阅的 RSS/播客链接，例如：订阅 https://example.com/feed.xml";
  const feed = rss.addFeed({ url, kind: /播客|podcast/.test(text) ? "podcast" : "rss" });
  const kindLabel = feed.kind === "podcast" ? "播客" : "RSS";
  return `已添加 ${kindLabel} 源：${feed.url}`;
}

function removeSubscriptionReply(rss: RssSubscriptions, text: string): string {
  const target = findUrl(text) ?? text.trim().split(/\s+/).pop();
  if (!target) return "请提供要取消订阅的源链接或 ID。";

  const feeds = rss.listFeeds();
  const feed = feeds.find((f) => f.url === target || f.id === target);
  if (!feed) return "未找到该订阅源。";

  rss.removeFeed(feed.id);
  return `已删除订阅源：${feed.url}`;
}

function listSubscriptionsReply(rss: RssSubscriptions): string {
  const feeds = rss.listFeeds();
  if (feeds.length === 0) return "当前没有订阅源。";
  const lines = feeds.map(
    (feed, index) => `${index + 1}. [${feed.kind === "podcast" ? "播客" : "RSS"}] ${feed.url}`,
  );
  return ["当前订阅源：", ...lines].join("\n");
}

export function handleSystemMessage(input: {
  text: string;
  bootstrap: Bootstrap;
  pipeline: ContentPipeline;
  language: string;
  rss?: RssSubscriptions;
}): string {
  if (isPrelearningDone(input.text)) {
    const completed = input.bootstrap.completePreLearning(input.language);
    if (!completed) {
      return "当前没有待完成的预学。新课会在你完成当前预学后推送。";
    }
    return (
      `已记录预学：${completed.events.length} 个语块进入调度，明天起到期。` +
      "好友角色会在之后的聊天里自然用上它们；下一课稍后推送。"
    );
  }

  if (input.rss && isListSubscriptionsIntent(input.text)) {
    return listSubscriptionsReply(input.rss);
  }

  if (input.rss && isRemoveSubscriptionIntent(input.text)) {
    return removeSubscriptionReply(input.rss, input.text);
  }

  if (input.rss && isAddSubscriptionIntent(input.text)) {
    return addSubscriptionReply(input.rss, input.text);
  }

  const url = findUrl(input.text);
  if (url) {
    // handleSystemMessage 是同步入口；调用方负责 await 并持久化回复。
    throw new SystemUrlIntentError(url);
  }

  return systemReply(input.text);
}

// 系统联系人收到 URL 时抛出此异常，由 server.ts 捕获后异步处理 pipeline。
export class SystemUrlIntentError extends Error {
  url: string;

  constructor(url: string) {
    super(`系统联系人收到链接：${url}`);
    this.url = url;
  }
}

export function formatIngestReply(result: Awaited<ReturnType<ContentPipeline["ingest"]>>): string {
  if (result.kind === "simplified") {
    const title = result.simplified?.title ?? "简化版";
    return `已生成简化版（${result.unlockLabel ?? `原文难度约 ${result.level}`}）：${title}\n原文链接：${result.original.sourceUrl}`;
  }
  if (result.kind === "unlock_queued") {
    return `已收入解锁队列，${result.unlockLabel}。等你的水平到位后会主动推送。`;
  }
  return `已收到链接，难度约 ${result.level}，可直接阅读。`;
}
