import { db, type DbClient } from "@/lib/db";
import { buildNotification, collapseByConversation, shouldPush, type PushConversation } from "./rules";
import type { PushNotification } from "./types";

const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_CONVERSATIONS = 30;
const PER_CONVERSATION = 20;

/**
 * 手机后台连接断开期间到达、仍未读的消息，按与实时推送相同的规则重新计算，每个会话合并成一条。
 * since 为客户端记录的上次收到推送/补拉时的服务端时间；最多回看 24 小时。
 */
export async function listMissedPush(
  userId: string,
  since: Date,
  now = new Date(),
  client: DbClient = db,
): Promise<PushNotification[]> {
  const from = new Date(Math.max(since.getTime(), now.getTime() - MAX_WINDOW_MS));
  const user = await client.user.findUnique({ where: { id: userId }, select: { isBot: true, active: true } });
  if (!user) return [];
  const members = await client.conversationMember.findMany({
    where: { userId, conversation: { lastMessageAt: { gt: from } } },
    select: {
      muted: true,
      lastReadSeq: true,
      conversation: { select: { id: true, type: true, name: true, botKey: true, lastSeq: true, lastMessageAt: true } },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: MAX_CONVERSATIONS * 2,
  });
  const out: PushNotification[] = [];
  let convs = 0;
  for (const m of members) {
    if (convs >= MAX_CONVERSATIONS) break;
    if (m.conversation.lastSeq <= m.lastReadSeq) continue;
    const conv = m.conversation as PushConversation;
    const rows = await client.message.findMany({
      where: {
        conversationId: conv.id,
        seq: { gt: m.lastReadSeq },
        createdAt: { gt: from },
        recalledAt: null,
        type: { not: "SYSTEM" },
        OR: [{ senderId: null }, { senderId: { not: userId } }],
      },
      orderBy: { seq: "desc" },
      take: PER_CONVERSATION,
      include: { sender: { select: { name: true } } },
    });
    const list: PushNotification[] = [];
    for (const row of rows.reverse()) {
      let content: unknown = null;
      let mentions: string[] = [];
      try {
        content = JSON.parse(row.content);
      } catch {}
      try {
        mentions = JSON.parse(row.mentions);
      } catch {}
      const msg = {
        id: row.id,
        seq: row.seq,
        type: row.type,
        senderId: row.senderId,
        senderName: row.sender?.name ?? null,
        text: row.text,
        content,
        mentions,
        createdAt: row.createdAt,
      };
      const recipient = { userId, muted: m.muted, isBot: user.isBot, active: user.active };
      if (shouldPush(conv, msg, recipient)) list.push(buildNotification(conv, msg, userId));
    }
    if (list.length) {
      out.push(...collapseByConversation(list));
      convs++;
    }
  }
  return out;
}
