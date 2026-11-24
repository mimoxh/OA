import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";

// /api/im/webhooks 由路由内部校验 Bearer Token
const PUBLIC_PATHS = ["/login", "/manifest.webmanifest", "/sw.js", "/api/im/webhooks"];

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
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
