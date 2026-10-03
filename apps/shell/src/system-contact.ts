// 系统联系人（ADR-0008）：扮演软件本身，纯工具文案无人格。
// 票 06 起承担 Bootstrap 课包预学完成的确认入口；订阅管理/小结属后续票据，
// 其余回复为固定文案，不经过任何模型。

import type { Bootstrap } from "@lingua/core";

export const SYSTEM_CONTACT_NAME = "系统";

export const SYSTEM_WELCOME =
  "系统已上线。我负责订阅管理、内容推送与学习小结（随后续版本开通）。日常对话请找好友角色。";

export function systemReply(_userText: string): string {
  return (
    "已收到。我目前只做工具通道：RSS 订阅与链接收纳将在后续版本开通。" +
    "练习对话请切换到好友角色。"
  );
}

// 预学完成意图（issue #6）：推送的课附带指引「预学完成后回复 完成」。
function isPrelearningDone(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.includes("完成") || normalized.includes("学完") || normalized === "done"
  );
}

export function handleSystemMessage(input: {
  text: string;
  bootstrap: Bootstrap;
  language: string;
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
  return systemReply(input.text);
}
