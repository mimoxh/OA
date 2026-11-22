import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { listMessages } from "@/lib/im/queries";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/im/conversations/[id]/messages">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const before = Number(req.nextUrl.searchParams.get("before"));
  const after = Number(req.nextUrl.searchParams.get("after"));
  const limit = Number(req.nextUrl.searchParams.get("limit"));
  const res = await listMessages(user.id, id, {
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    after: Number.isFinite(after) && after > 0 ? after : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });
  if (!res) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json(res);
}
