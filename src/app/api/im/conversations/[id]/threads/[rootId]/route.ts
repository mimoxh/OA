import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { listThreadMessages } from "@/lib/im/queries";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/im/conversations/[id]/threads/[rootId]">) {
  const { id, rootId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const before = Number(req.nextUrl.searchParams.get("before"));
  const limit = Number(req.nextUrl.searchParams.get("limit"));
  const res = await listThreadMessages(user.id, id, rootId, {
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });
  if (!res) return NextResponse.json({ error: "话题不存在" }, { status: 404 });
  return NextResponse.json(res);
}
