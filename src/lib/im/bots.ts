// 机器人会话展示信息：可在客户端组件中引用

export type BotKey = "approval" | "project" | "docs" | "system";

export const BOTS: Record<BotKey, { name: string; color: string }> = {
  approval: { name: "审批助手", color: "#e16b16" },
  project: { name: "项目助手", color: "#337ea9" },
  docs: { name: "文档助手", color: "#2383e2" },
  system: { name: "系统通知", color: "#787774" },
};

/** Notification.type → 归属的机器人会话 */
export function botForNotifyType(type: string): BotKey {
  if (type === "approval") return "approval";
  if (type === "task") return "project";
  if (type === "mention" || type === "comment") return "docs";
  return "system";
}
