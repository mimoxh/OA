import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { signScopedToken } from "@/lib/auth/token";
import { publicWsUrl } from "@/lib/ws-url";

const TOKEN_TTL_SECONDS = 60 * 60;

/** 实时通道短期令牌（ws 连接参数用），与会话 Cookie 一样不可被前端直接读取 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const token = await signScopedToken("rt", user.id, TOKEN_TTL_SECONDS);
  return NextResponse.json(
    // NEXT_PUBLIC_* 会在构建时内联进产物，REALTIME_PUBLIC_URL 才是运行时读取
    { token, url: publicWsUrl(req, process.env.REALTIME_PUBLIC_URL ?? process.env.NEXT_PUBLIC_REALTIME_URL, "ws://localhost:1235") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
