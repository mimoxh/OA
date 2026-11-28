import type { DbClient } from "@/lib/db";
import type { MessageDTO } from "@/lib/im/types";
import { hasRealtimeBuffer, queuePush } from "@/lib/realtime/buffer";
import { computePushNotifications, type PushConversation } from "./rules";

/**
 * 新消息写入后调用（与 queueEvent 同一时机）：计算接收人提醒并放进当前请求的缓冲区，事务提交后由驱动发出。
 * 不在缓冲区上下文（种子脚本、离线任务）时直接跳过，不查库。
 */
export async function queueMessagePush(client: DbClient, conversationId: string, dto: MessageDTO, senderId: string | null) {
  if (!hasRealtimeBuffer() || dto.type === "SYSTEM") return;
  const conv = await client.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      type: true,
      name: true,
      botKey: true,
      members: { select: { userId: true, muted: true, user: { select: { isBot: true, active: true } } } },
    },
  });
  if (!conv) return;
  const notifications = computePushNotifications(
    conv as PushConversation,
    {
      id: dto.id,
      seq: dto.seq,
      type: dto.type,
      senderId,
      senderName: dto.sender?.name ?? null,
      text: dto.text,
      content: dto.content,
      mentions: dto.mentions,
      recalled: dto.recalled,
      createdAt: dto.createdAt,
    },
    conv.members.map((m) => ({ userId: m.userId, muted: m.muted, isBot: m.user.isBot, active: m.user.active })),
  );
  for (const notification of notifications) queuePush({ kind: "notify", notification });
}

/** 某用户读到 seq：让其各设备撤掉该会话的提醒 */
export function queuePushClear(userId: string, conversationId: string, seq: number) {
  queuePush({ kind: "clear", userId, conversationId, seq });
}
