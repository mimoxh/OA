import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { withRealtimeBuffer } from "@/lib/realtime/buffer";
import { startOrJoinCall } from "@/lib/im/call-service";

const BodySchema = z.object({
  conversationId: z.string().min(1),
  kind: z.enum(["audio", "video"]).default("video"),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数无效" }, { status: 400 });

  try {
    const { result, flush } = await withRealtimeBuffer(() =>
      db.$transaction((tx) =>
        startOrJoinCall(tx, {
          userId: user.id,
          conversationId: parsed.data.conversationId,
          kind: parsed.data.kind,
        }),
      ),
    );
    await flush();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "发起通话失败";
    const status = msg.includes("不在会话") || msg.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
