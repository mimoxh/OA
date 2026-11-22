import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getConversation } from "@/lib/im/queries";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/im/conversations/[id]">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const res = await getConversation(user.id, id);
  if (!res) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json(res);
}
