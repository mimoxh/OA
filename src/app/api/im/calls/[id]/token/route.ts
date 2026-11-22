import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getCallForMember } from "@/lib/im/call-service";
import { getRtcJoinConfig } from "@/lib/rtc/provider";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/im/calls/[id]/token">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const call = await getCallForMember(user.id, id);
  if (!call) return NextResponse.json({ error: "通话不存在或无权限" }, { status: 404 });
  if (call.status === "ENDED") return NextResponse.json({ error: "通话已结束" }, { status: 409 });

  const requestedProvider = req.nextUrl.searchParams.get("provider");
  const rtc = await getRtcJoinConfig({
    roomName: call.roomName,
    userId: user.id,
    userName: user.name,
    preferredProvider: requestedProvider === "webrtc" || requestedProvider === "livekit" ? requestedProvider : call.provider,
  });
  return NextResponse.json({ call, rtc }, { headers: { "Cache-Control": "no-store" } });
}
