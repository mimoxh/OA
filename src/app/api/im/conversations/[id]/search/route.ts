import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { searchConversationMessages } from "@/lib/im/queries";

const KINDS = new Set(["all", "image", "file", "link"]);

export async function GET(req: NextRequest, ctx: RouteContext<"/api/im/conversations/[id]/search">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const rawKind = sp.get("kind") ?? "all";
  const kind = (KINDS.has(rawKind) ? rawKind : "all") as "all" | "image" | "file" | "link";
  const senderId = sp.get("senderId") || undefined;
  const before = Number(sp.get("before"));
  const limit = Number(sp.get("limit"));
  const res = await searchConversationMessages(user.id, id, {
    q,
    kind,
    senderId,
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });
  if (!res) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json(res);
}
