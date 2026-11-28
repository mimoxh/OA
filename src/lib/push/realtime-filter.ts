/**
 * 实时服务（server/realtime.ts）的连接分类与投递过滤，抽成纯函数便于单元测试。
 *
 * - web：浏览器 / 桌面端页面（默认）；
 * - app：手机 App 内的 WebView 页面（?client=app），前台时由它弹 App 内提醒；
 * - bg：手机 App 的后台前台服务连接（?client=bg），只用来接收推送，不计入在线状态。
 */
export type RtClientKind = "web" | "app" | "bg";

/** 电脑端最近有操作（页面可见、有焦点、有键鼠输入）的有效期；超过即视为离开 */
export const DESKTOP_ACTIVE_MS = 3 * 60 * 1000;

export function parseClientKind(value: string | null | undefined): RtClientKind {
  return value === "bg" || value === "app" ? value : "web";
}

export function countsForPresence(kind: RtClientKind): boolean {
  return kind !== "bg";
}

/** push.* 只给手机（后台连接与 App 内页面）；其余事件不发给后台连接，省电也省流量 */
export function shouldSendToClient(kind: RtClientKind, eventType: string): boolean {
  if (eventType.startsWith("push.")) return kind !== "web";
  return kind !== "bg";
}

/** 该用户是否正在电脑（或其他浏览器）上活跃：是则手机端的提醒改为静默，避免两边同时响 */
export function isActiveOnDesktop(clients: Iterable<{ kind: RtClientKind; activeAt: number }>, now: number): boolean {
  for (const c of clients) {
    if (c.kind === "web" && c.activeAt > 0 && now - c.activeAt < DESKTOP_ACTIVE_MS) return true;
  }
  return false;
}
