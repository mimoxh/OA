import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getMessageReceipts } from "@/lib/im/queries";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/im/conversations/[id]/receipts">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const seq = Number(req.nextUrl.searchParams.get("seq"));
  if (!Number.isInteger(seq) || seq <= 0) {
    return NextResponse.json({ error: "无效的消息序号" }, { status: 400 });
  }
  const res = await getMessageReceipts(user.id, id, seq);
  if (!res) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json(res);
}
