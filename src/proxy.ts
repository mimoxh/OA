import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, renewSessionToken, sessionCookieOptions, verifySessionToken } from "@/lib/auth/token";

// /api/im/webhooks 由路由内部校验（回调用 Bearer Token；orca-catalog 校验登录会话）
// /download/android 与 /api/mobile/version：安装 App 之前、未登录的旧版 App 都要能访问
const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/manifest.webmanifest",
  "/sw.js",
  "/api/im/webhooks",
  "/api/mobile/version",
  "/download/android",
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  // 只在 GET/HEAD 上续期：POST（Server Action）里登录/退出会自己写会话 Cookie，避免同一响应里两条 Set-Cookie 互相覆盖
  if (session && (request.method === "GET" || request.method === "HEAD")) {
    const renewed = await renewSessionToken(session);
    if (renewed) res.cookies.set(SESSION_COOKIE, renewed.token, sessionCookieOptions(renewed.maxAge));
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
