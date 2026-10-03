// 系统联系人（ADR-0008）：扮演软件本身，纯工具文案无人格。
// MVP 阶段订阅管理/推送/小结属后续票据，回复为固定文案，不经过任何模型。

export const SYSTEM_CONTACT_NAME = "系统";

export const SYSTEM_WELCOME =
  "系统已上线。我负责订阅管理、内容推送与学习小结（随后续版本开通）。日常对话请找好友角色。";

export function systemReply(_userText: string): string {
  return (
    "已收到。我目前只做工具通道：RSS 订阅与链接收纳将在后续版本开通。" +
    "练习对话请切换到好友角色。"
  );
}
