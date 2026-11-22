import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { withRealtimeBuffer } from "@/lib/realtime/buffer";
import { actOnCall } from "@/lib/im/call-service";

const BodySchema = z.object({
  action: z.enum(["accept", "reject", "end"]),
});

export async function POST(req: NextRequest, ctx: RouteContext<"/api/im/calls/[id]/action">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  try {
    const { result, flush } = await withRealtimeBuffer(() =>
      db.$transaction((tx) =>
        actOnCall(tx, {
          userId: user.id,
          callId: id,
          action: parsed.data.action,
        }),
      ),
    );
    await flush();
    return NextResponse.json({ call: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "操作失败";
    const status = msg.includes("不在会话") || msg.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
