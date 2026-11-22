import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { listActiveCallsForUser } from "@/lib/im/call-service";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const conversationId = req.nextUrl.searchParams.get("conversationId") ?? undefined;
  const calls = await listActiveCallsForUser(user.id, conversationId);
  return NextResponse.json({ calls });
}
