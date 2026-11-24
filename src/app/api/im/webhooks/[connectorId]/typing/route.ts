import type { NextRequest } from "next/server";
import { handleWebhookTyping } from "@/lib/im/webhook-inbound";

// 不走会话 Cookie：由 Authorization: Bearer <inbound token> 鉴权（proxy.ts 已放行 /api/im/webhooks）
export async function POST(req: NextRequest, ctx: RouteContext<"/api/im/webhooks/[connectorId]/typing">) {
  const { connectorId } = await ctx.params;
  return handleWebhookTyping(req, connectorId);
}
