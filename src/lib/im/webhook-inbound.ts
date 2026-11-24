import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { publish } from "@/lib/realtime/publish";
import { withRealtimeBuffer } from "@/lib/realtime/buffer";
import { conversationUserIds } from "./queries";
import { requireMember, sendBotReplyMessage } from "./service";
import { parseBearer, verifyInboundToken } from "./webhook-crypto";
import { writeDeliveryLog } from "./webhook-outbound";

const REF_TYPES = ["document", "approval", "customer", "opportunity", "sales", "purchase", "project", "transport", "event"] as const;

const safeLink = z
  .string()
  .max(2000)
  .refine((v) => (v.startsWith("/") && !v.startsWith("//")) || /^https?:\/\//i.test(v), "链接仅支持站内路径或 http(s) 地址");

const cardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000).nullish(),
  link: safeLink.nullish(),
  ref: z.object({ type: z.enum(REF_TYPES), id: z.string().min(1).max(64) }).nullish(),
  fields: z.array(z.object({ label: z.string().max(50), value: z.string().max(500) })).max(20).optional(),
  status: z
    .object({ label: z.string().max(20), color: z.enum(["blue", "green", "red", "gray", "orange"]) })
    .nullish(),
});

export const replyBodySchema = z
  .object({
    conversationId: z.string().min(1).max(64),
    text: z.string().max(5000, "消息不能超过 5000 字").optional(),
    card: cardSchema.optional(),
    clientMsgId: z.string().min(1).max(64).optional(),
    replyToId: z.string().min(1).max(64).nullish(),
    threadRootId: z.string().min(1).max(64).nullish(),
  })
  .refine((v) => !!v.card || !!v.text?.trim(), { message: "text 与 card 至少提供一项" });

const typingBodySchema = z.object({ conversationId: z.string().min(1).max(64) });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type AuthedConnector = { id: string; botUserId: string; botName: string };

async function authenticate(
  connectorId: string,
  authorization: string | null,
): Promise<{ connector: AuthedConnector } | { response: Response }> {
  const token = parseBearer(authorization);
  const connector = connectorId
    ? await db.webhookConnector.findUnique({
        where: { id: connectorId },
        include: { botUser: { select: { id: true, name: true, active: true, isBot: true } } },
      })
    : null;
  // 连接器不存在与 Token 错误返回相同响应，避免探测
  if (!connector || !verifyInboundToken(token, connector.inboundTokenHash)) {
    return { response: json({ error: "Token 无效" }, 401) };
  }
  if (!connector.enabled || !connector.botUser.active || !connector.botUser.isBot) {
    return { response: json({ error: "Webhook 机器人已停用" }, 403) };
  }
  return { connector: { id: connector.id, botUserId: connector.botUserId, botName: connector.botUser.name } };
}

function errorStatus(msg: string) {
  if (msg.includes("不在该会话")) return 403;
  if (msg.includes("不存在")) return 404;
  return 400;
}

async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

/** POST /api/im/webhooks/[connectorId]/reply */
export async function handleWebhookReply(req: Request, connectorId: string): Promise<Response> {
  const auth = await authenticate(connectorId, req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  const { connector } = auth;
  const started = Date.now();

  const parsed = replyBodySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const error = parsed.error.issues[0]?.message ?? "参数无效";
    await writeDeliveryLog(db, { connectorId: connector.id, direction: "INBOUND", event: "reply", ok: false, httpStatus: 400, error });
    return json({ error }, 400);
  }
  const v = parsed.data;
  try {
    const { result, flush } = await withRealtimeBuffer(() =>
      db.$transaction((tx) =>
        sendBotReplyMessage(tx, {
          conversationId: v.conversationId,
          botUserId: connector.botUserId,
          text: v.text ?? null,
          card: v.card ? { template: "generic", ...v.card } : null,
          clientMsgId: v.clientMsgId ?? null,
          replyToId: v.replyToId ?? null,
          threadRootId: v.threadRootId ?? null,
        }),
      ),
    );
    await flush();
    await writeDeliveryLog(db, {
      connectorId: connector.id,
      direction: "INBOUND",
      event: "reply",
      conversationId: v.conversationId,
      messageId: result.message.id,
      ok: true,
      httpStatus: 200,
      latencyMs: Date.now() - started,
    });
    return json({
      ok: true,
      created: result.created,
      conversationId: v.conversationId,
      messageId: result.message.id,
      seq: result.message.seq,
    });
  } catch (e) {
    const internal = !(e instanceof Error) || e instanceof Prisma.PrismaClientKnownRequestError;
    if (internal) console.error("[webhook] 入站回复失败", e);
    const error = internal ? "服务器内部错误" : (e as Error).message;
    const status = internal ? 500 : errorStatus(error);
    await writeDeliveryLog(db, {
      connectorId: connector.id,
      direction: "INBOUND",
      event: "reply",
      conversationId: v.conversationId,
      ok: false,
      httpStatus: status,
      latencyMs: Date.now() - started,
      error,
    });
    return json({ error }, status);
  }
}

/** POST /api/im/webhooks/[connectorId]/typing —— 向会话其他成员广播「正在输入」 */
export async function handleWebhookTyping(req: Request, connectorId: string): Promise<Response> {
  const auth = await authenticate(connectorId, req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  const { connector } = auth;
  const parsed = typingBodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "参数无效" }, 400);
  try {
    await requireMember(db, parsed.data.conversationId, connector.botUserId);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "你不在该会话中" }, 403);
  }
  const ids = (await conversationUserIds(db, parsed.data.conversationId)).filter((id) => id !== connector.botUserId);
  await publish([{ userIds: ids, event: { type: "typing", conversationId: parsed.data.conversationId, userId: connector.botUserId } }]);
  return json({ ok: true });
}
