import type { NextRequest } from "next/server";

/**
 * 返回给浏览器的实时 / 协同 WebSocket 地址。
 * 以 "/" 开头表示经网关同源转发：主机取自当前请求，局域网内各终端拿到的都是自己访问用的地址
 * （桌面一体包配置为 /collab 与 /rt）。
 */
export function publicWsUrl(req: NextRequest, configured: string | undefined, fallback: string): string {
  const value = configured?.trim() || fallback;
  if (!value.startsWith("/")) return value;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "")).split(",")[0].trim();
  return `${proto === "https" ? "wss" : "ws"}://${host}${value}`;
}
