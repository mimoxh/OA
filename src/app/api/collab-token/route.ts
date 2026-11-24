import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { signScopedToken } from "@/lib/auth/token";
import { getDocAccess } from "@/lib/docs/access";
import { publicWsUrl } from "@/lib/ws-url";

const TOKEN_TTL_SECONDS = 60 * 60;

/** 协同服务短期令牌：会话 Cookie 是 httpOnly，浏览器无法直接读取，因此由这里签发 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const docId = req.nextUrl.searchParams.get("doc") ?? "";
  const res = docId ? await getDocAccess(user, docId) : null;
  if (!res || !res.canRead) return NextResponse.json({ error: "没有权限访问该文档" }, { status: 403 });
  const token = await signScopedToken("collab", user.id, TOKEN_TTL_SECONDS);
  return NextResponse.json(
    {
      token,
      readOnly: !res.canWrite,
      // NEXT_PUBLIC_* 会在构建时内联进产物，COLLAB_PUBLIC_URL 才是运行时读取
      url: publicWsUrl(req, process.env.COLLAB_PUBLIC_URL ?? process.env.NEXT_PUBLIC_COLLAB_URL, `ws://localhost:${process.env.COLLAB_PORT ?? 1234}`),
      user: { id: user.id, name: user.name, color: user.avatarColor },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
