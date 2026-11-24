import type { NextRequest } from "next/server";
import { handleWebhookReply } from "@/lib/im/webhook-inbound";

// 不走会话 Cookie：由 Authorization: Bearer <inbound token> 鉴权（proxy.ts 已放行 /api/im/webhooks）
export async function POST(req: NextRequest, ctx: RouteContext<"/api/im/webhooks/[connectorId]/reply">) {
  const { connectorId } = await ctx.params;
  return handleWebhookReply(req, connectorId);
}
