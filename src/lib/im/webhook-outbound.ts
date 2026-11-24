import { randomUUID } from "node:crypto";
import { db, type DbClient } from "@/lib/db";
import { assertResolvedPublic, decryptOptional, decryptSecret, parseHeadersJson, signPayload } from "./webhook-crypto";
import { getConversationRunConfig, resolveRunMetadata } from "./webhook-run-config";

export type TriggerMode = "mention_only" | "all";
export const TRIGGER_MODES: TriggerMode[] = ["mention_only", "all"];

const DELIVERY_TIMEOUT_MS = 5000;
const LOG_KEEP_PER_CONNECTOR = 200;

export function normalizeTriggerMode(v: string | null | undefined): TriggerMode {
  return v === "all" ? "all" : "mention_only";
}

export function publicBaseUrl(): string {
  return (process.env.OA_PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

export function replyEndpoint(connectorId: string): string {
  return `${publicBaseUrl()}/api/im/webhooks/${connectorId}/reply`;
}

export function typingEndpoint(connectorId: string): string {
  return `${publicBaseUrl()}/api/im/webhooks/${connectorId}/typing`;
}

/**
 * 是否需要把这条消息投递给某个 Webhook 机器人。
 * 防循环：发送者为空（系统消息）或为机器人时一律不触发。
 */
export function shouldTriggerWebhook(input: {
  conversationType: string;
  messageType: string;
  triggerMode: string;
  botUserId: string;
  sender: { id: string | null; isBot: boolean } | null;
  mentions: string[];
  replyToSenderId?: string | null;
  threadRootSenderId?: string | null;
}): boolean {
  const sender = input.sender;
  if (!sender || !sender.id || sender.isBot) return false;
  if (sender.id === input.botUserId) return false;
  if (input.messageType === "SYSTEM") return false;
  if (input.conversationType === "DIRECT") return true;
  if (input.conversationType !== "GROUP") return false;
  if (normalizeTriggerMode(input.triggerMode) === "all") return true;
  if (input.mentions.includes(input.botUserId) || input.mentions.includes("all")) return true;
  if (input.replyToSenderId && input.replyToSenderId === input.botUserId) return true;
  if (input.threadRootSenderId && input.threadRootSenderId === input.botUserId) return true;
  return false;
}

export type ConnectorSecrets = {
  id: string;
  outboundUrl: string;
  outboundSecret: string | null;
  outboundHeaders: string | null;
};

export type DeliveryResult = {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
};

function truncate(s: string, n = 500) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 解密配置并 POST JSON；永不抛出 */
export async function deliverWebhook(
  connector: ConnectorSecrets,
  payload: { deliveryId: string; timestamp: string } & Record<string, unknown>,
): Promise<DeliveryResult> {
  const started = Date.now();
  const fail = (error: string, httpStatus: number | null = null): DeliveryResult => ({
    ok: false,
    httpStatus,
    latencyMs: Date.now() - started,
    error: truncate(error),
  });
  let url: string;
  let secret: string | null;
  let custom: Record<string, string>;
  try {
    url = decryptSecret(connector.outboundUrl);
    secret = decryptOptional(connector.outboundSecret);
    custom = parseHeadersJson(decryptOptional(connector.outboundHeaders));
  } catch {
    return fail("凭据解密失败（AUTH_SECRET 可能已变更），请重新保存配置");
  }
  try {
    await assertResolvedPublic(url);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Outbound URL 不可用");
  }
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    ...custom,
    "Content-Type": "application/json",
    "User-Agent": "OA-Webhook/1.0",
    "X-OA-Webhook-Id": connector.id,
    "X-OA-Delivery-Id": payload.deliveryId,
    "X-OA-Timestamp": payload.timestamp,
  };
  if (secret) headers["X-OA-Signature"] = signPayload(secret, body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: true, httpStatus: res.status, latencyMs, error: null };
    }
    const text = await res.text().catch(() => "");
    const reason = res.status >= 300 && res.status < 400 ? "目标返回重定向（出于安全考虑不跟随）" : `HTTP ${res.status}`;
    return { ok: false, httpStatus: res.status, latencyMs, error: truncate(text ? `${reason}: ${text}` : reason) };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return fail(`请求超时（>${DELIVERY_TIMEOUT_MS}ms）`);
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : "";
    return fail(`${e instanceof Error ? e.message : "请求失败"}${cause}`);
  }
}

export async function writeDeliveryLog(
  client: DbClient,
  input: {
    connectorId: string;
    direction: "OUTBOUND" | "INBOUND";
    event: string;
    conversationId?: string | null;
    messageId?: string | null;
    ok: boolean;
    httpStatus?: number | null;
    latencyMs?: number | null;
    error?: string | null;
  },
) {
  try {
    await client.webhookDeliveryLog.create({
      data: {
        connectorId: input.connectorId,
        direction: input.direction,
        event: input.event,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        status: input.ok ? "SUCCESS" : "FAILED",
        httpStatus: input.httpStatus ?? null,
        latencyMs: input.latencyMs ?? null,
        error: input.error ? truncate(input.error) : null,
      },
    });
    const cutoff = await client.webhookDeliveryLog.findFirst({
      where: { connectorId: input.connectorId },
      orderBy: { createdAt: "desc" },
      skip: LOG_KEEP_PER_CONNECTOR,
      select: { createdAt: true },
    });
    if (cutoff) {
      await client.webhookDeliveryLog.deleteMany({ where: { connectorId: input.connectorId, createdAt: { lte: cutoff.createdAt } } });
    }
  } catch (e) {
    console.error("[webhook] 写入投递日志失败", e);
  }
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export type MessageDispatch = { connectorId: string; botUserId: string; result: DeliveryResult };

/**
 * 新消息落库（事务已提交）后调用：找出会话中启用的 Webhook 机器人并逐个投递。
 * 永不抛出；失败写入 WebhookDeliveryLog。
 */
export async function dispatchMessageWebhooks(messageId: string, client: DbClient = db): Promise<MessageDispatch[]> {
  try {
    const msg = await client.message.findUnique({
      where: { id: messageId },
      include: {
        sender: { select: { id: true, name: true, email: true, title: true, isBot: true } },
        conversation: { select: { id: true, type: true, name: true, bizType: true, bizId: true } },
      },
    });
    if (!msg || !msg.senderId || !msg.sender || msg.sender.isBot) return [];
    if (msg.type === "SYSTEM" || msg.recalledAt) return [];
    const conv = msg.conversation;
    if (conv.type !== "DIRECT" && conv.type !== "GROUP") return [];

    const connectors = await client.webhookConnector.findMany({
      where: {
        enabled: true,
        botUserId: { not: msg.senderId },
        botUser: { active: true, isBot: true, imMemberships: { some: { conversationId: msg.conversationId } } },
      },
      include: { botUser: { select: { id: true, name: true } } },
    });
    if (!connectors.length) return [];

    const relatedIds = [msg.replyToId, msg.threadRootId].filter((x): x is string => !!x);
    const related = relatedIds.length
      ? await client.message.findMany({ where: { id: { in: relatedIds } }, select: { id: true, senderId: true } })
      : [];
    const senderOf = (id: string | null) => (id ? (related.find((r) => r.id === id)?.senderId ?? null) : null);
    const mentions = parseJsonArray<string>(msg.mentions).filter((x) => typeof x === "string");
    const links = parseJsonArray<{ type: string; id: string }>(msg.links);

    const targets = connectors.filter((c) =>
      shouldTriggerWebhook({
        conversationType: conv.type,
        messageType: msg.type,
        triggerMode: c.triggerMode,
        botUserId: c.botUserId,
        sender: { id: msg.senderId, isBot: msg.sender!.isBot },
        mentions,
        replyToSenderId: senderOf(msg.replyToId),
        threadRootSenderId: senderOf(msg.threadRootId),
      }),
    );
    if (!targets.length) return [];
    const runOverride = await getConversationRunConfig(client, conv.id);

    return await Promise.all(
      targets.map(async (c) => {
        const payload = {
          event: "im.message.created",
          deliveryId: randomUUID(),
          timestamp: new Date().toISOString(),
          connector: { id: c.id, botUserId: c.botUserId, botName: c.botUser.name },
          metadata: resolveRunMetadata(c, runOverride),
          conversation: {
            id: conv.id,
            type: conv.type,
            name: conv.type === "DIRECT" ? msg.sender!.name : (conv.name ?? "群聊"),
            bizType: conv.bizType,
            bizId: conv.bizId,
          },
          message: {
            id: msg.id,
            seq: msg.seq,
            type: msg.type,
            text: msg.text,
            mentions,
            links,
            replyToId: msg.replyToId,
            threadRootId: msg.threadRootId,
            createdAt: msg.createdAt.toISOString(),
          },
          sender: { id: msg.sender!.id, name: msg.sender!.name, email: msg.sender!.email, title: msg.sender!.title },
          reply: {
            endpoint: replyEndpoint(c.id),
            conversationId: conv.id,
            threadRootId: msg.threadRootId,
            replyToId: msg.id,
          },
        };
        const result = await deliverWebhook(c, payload);
        await writeDeliveryLog(client, {
          connectorId: c.id,
          direction: "OUTBOUND",
          event: "im.message.created",
          conversationId: conv.id,
          messageId: msg.id,
          ok: result.ok,
          httpStatus: result.httpStatus,
          latencyMs: result.latencyMs,
          error: result.error,
        });
        if (!result.ok) console.warn(`[webhook] 投递失败 connector=${c.id} message=${msg.id}: ${result.error}`);
        return { connectorId: c.id, botUserId: c.botUserId, result };
      }),
    );
  } catch (e) {
    console.error("[webhook] 出站分发异常", e);
    return [];
  }
}

/** 连通性测试：发送 webhook.ping */
export async function pingConnector(connectorId: string, client: DbClient = db): Promise<DeliveryResult> {
  const c = await client.webhookConnector.findUnique({ where: { id: connectorId }, include: { botUser: { select: { name: true } } } });
  if (!c) throw new Error("Webhook 机器人不存在");
  const result = await deliverWebhook(c, {
    event: "webhook.ping",
    deliveryId: randomUUID(),
    timestamp: new Date().toISOString(),
    connector: { id: c.id, botUserId: c.botUserId, botName: c.botUser.name },
    metadata: resolveRunMetadata(c),
    reply: { endpoint: replyEndpoint(c.id) },
  });
  await writeDeliveryLog(client, {
    connectorId: c.id,
    direction: "OUTBOUND",
    event: "webhook.ping",
    ok: result.ok,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    error: result.error,
  });
  return result;
}
