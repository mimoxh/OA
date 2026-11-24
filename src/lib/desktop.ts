import "server-only";
import { headers } from "next/headers";

/** 桌面客户端会在 WebView 的 User-Agent 末尾追加该标记，服务端据此直接渲染桌面顶栏 */
export const DESKTOP_UA_MARK = "OADesktop/";

export async function isDesktopRequest(): Promise<boolean> {
  return ((await headers()).get("user-agent") ?? "").includes(DESKTOP_UA_MARK);
}
