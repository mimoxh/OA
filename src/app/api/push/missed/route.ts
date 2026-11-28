import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { listMissedPush } from "@/lib/push/missed";

/**
 * 手机后台连接重连后补拉：GET /api/push/missed?since=<毫秒时间戳>。
 * 返回服务端当前时间（下次补拉的游标）和断线期间漏掉的提醒（每个会话一条）；不带 since 时只返回 now。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const now = new Date();
  const raw = Number(req.nextUrl.searchParams.get("since"));
  const notifications = Number.isFinite(raw) && raw > 0 ? await listMissedPush(user.id, new Date(raw), now) : [];
  return NextResponse.json(
    { now: now.getTime(), notifications },
    { headers: { "Cache-Control": "no-store" } },
  );
}
