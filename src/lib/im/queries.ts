import type { Conversation, ConversationMember, Message, User } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";
import { BIZ_META, isBizType } from "./biz-meta";
import { BOTS, type BotKey } from "./bots";
import type { ConversationDTO, MessageDTO, UserLite } from "./types";

const GROUP_COLORS = ["#e16b16", "#d44c8a", "#2383e2", "#448361", "#9065b0", "#cb912f", "#337ea9"];

const liteUser = { id: true, name: true, avatarColor: true } as const;
export const userLiteSelect = liteUser;

export type MemberRow = ConversationMember & { user?: Pick<User, "id" | "name" | "avatarColor"> };
export type MessageRow = Message & { sender?: Pick<User, "id" | "name" | "avatarColor"> | null };

function groupColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return GROUP_COLORS[Math.abs(h) % GROUP_COLORS.length];
}

export function toConversationDTO(
  member: ConversationMember,
  conv: Conversation,
  info: { memberCount: number; peer?: Pick<User, "id" | "name" | "avatarColor"> | null },
  lastMessage: (Message & { sender?: Pick<User, "name"> | null }) | null,
): ConversationDTO {
  const me = member;
  let name = conv.name ?? "群聊";
  let avatarColor = groupColor(conv.id);
  let peerId: string | null = null;
  if (conv.type === "DIRECT") {
    peerId = info.peer?.id ?? null;
    name = info.peer?.name ?? "已注销用户";
    avatarColor = info.peer?.avatarColor ?? "#787774";
  } else if (conv.type === "BOT") {
    const bot = BOTS[(conv.botKey ?? "system") as BotKey] ?? BOTS.system;
    name = bot.name;
    avatarColor = bot.color;
  }
  const bizType = isBizType(conv.bizType) ? conv.bizType : null;
  const bizId = bizType && conv.bizId ? conv.bizId : null;
  const bizMeta = bizType ? BIZ_META[bizType] : null;
  const lm = lastMessage;
  return {
    id: conv.id,
    type: conv.type,
    name,
    avatarColor,
    botKey: conv.botKey,
    bizType,
    bizId,
    bizHref: bizMeta && bizId ? bizMeta.href(bizId) : null,
    bizLabel: bizMeta ? bizMeta.detailLabel : null,
    peerId,
    memberCount: info.memberCount,
    role: member.role,
    lastSeq: conv.lastSeq,
    lastReadSeq: me.lastReadSeq,
    unread: Math.max(0, conv.lastSeq - me.lastReadSeq),
    pinned: me.pinned,
    muted: me.muted,
    lastMessage: lm
      ? {
          seq: lm.seq,
          type: lm.type,
          text: lm.recalledAt ? "" : lm.text,
          senderName: lm.sender?.name ?? null,
          recalled: !!lm.recalledAt,
          createdAt: lm.createdAt.toISOString(),
        }
      : null,
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    createdAt: conv.createdAt.toISOString(),
  };
}

type ReplyRow = { id: string; seq: number; text: string; recalledAt: Date | null; sender: { name: string } | null };

export async function toMessageDTO(client: DbClient, msg: MessageRow): Promise<MessageDTO> {
  let replyTo: MessageDTO["replyTo"] = null;
  if (msg.replyToId) {
    const target = (await client.message.findUnique({
      where: { id: msg.replyToId },
      select: { id: true, seq: true, text: true, recalledAt: true, sender: { select: { name: true } } },
    })) as ReplyRow | null;
    if (target) {
      replyTo = {
        id: target.id,
        seq: target.seq,
        senderName: target.sender?.name ?? null,
        text: target.recalledAt ? "" : target.text,
        recalled: !!target.recalledAt,
      };
    }
  }
  return messageDTO(msg, replyTo);
}

export function messageDTO(msg: MessageRow, replyTo: MessageDTO["replyTo"]): MessageDTO {
  const recalled = !!msg.recalledAt;
  let content: unknown | null = null;
  if (!recalled) {
    try {
      content = JSON.parse(msg.content);
    } catch {
      content = null;
    }
  }
  let mentions: string[] = [];
  let links: MessageDTO["links"] = [];
  try {
    mentions = JSON.parse(msg.mentions);
  } catch {}
  try {
    links = JSON.parse(msg.links);
  } catch {}
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    seq: msg.seq,
    type: msg.type,
    sender: msg.sender ? { id: msg.sender.id, name: msg.sender.name, avatarColor: msg.sender.avatarColor } : null,
    content,
    text: recalled ? "" : msg.text,
    mentions,
    links,
    replyTo,
    clientMsgId: msg.clientMsgId,
    recalled,
    createdAt: msg.createdAt.toISOString(),
  };
}

/** 会话成员 ids（service / 路由共用） */
export async function conversationUserIds(client: DbClient, conversationId: string): Promise<string[]> {
  const rows = await client.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

export async function listConversations(userId: string, client: DbClient = db): Promise<ConversationDTO[]> {
  const rows = await client.conversationMember.findMany({
    where: { userId },
    include: {
      conversation: {
        include: {
          _count: { select: { members: true } },
          // 单聊只需对端 1 行（群聊该行结果不使用）
          members: { where: { userId: { not: userId } }, take: 1, include: { user: { select: liteUser } } },
          messages: { orderBy: { seq: "desc" }, take: 1, include: { sender: { select: { name: true } } } },
        },
      },
    },
  });
  const list = rows.map((m) => ({
    member: m,
    conv: m.conversation,
    dto: toConversationDTO(
      m,
      m.conversation,
      { memberCount: m.conversation._count.members, peer: m.conversation.members[0]?.user ?? null },
      m.conversation.messages[0] ?? null,
    ),
  }));
  return list
    .filter((x) => !x.member.hidden || x.dto.unread > 0)
    .sort(
      (a, b) =>
        Number(b.dto.pinned) - Number(a.dto.pinned) ||
        (b.dto.lastMessageAt ?? "").localeCompare(a.dto.lastMessageAt ?? "") ||
        b.dto.createdAt.localeCompare(a.dto.createdAt),
    )
    .map((x) => x.dto);
}

export async function getConversation(
  userId: string,
  conversationId: string,
  client: DbClient = db,
): Promise<{ conversation: ConversationDTO; members: (UserLite & { role: string })[] | null } | null> {
  const member = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: {
      conversation: {
        include: {
          members: { include: { user: { select: liteUser } } },
          messages: { orderBy: { seq: "desc" }, take: 1, include: { sender: { select: { name: true } } } },
        },
      },
    },
  });
  if (!member) return null;
  const conv = member.conversation;
  const dto = toConversationDTO(
    member,
    conv,
    { memberCount: conv.members.length, peer: conv.members.find((m) => m.userId !== userId)?.user ?? null },
    conv.messages[0] ?? null,
  );
  const members =
    conv.type === "GROUP"
      ? conv.members.map((m) => ({
          id: m.user!.id,
          name: m.user!.name,
          avatarColor: m.user!.avatarColor,
          role: m.role,
        }))
      : null;
  return { conversation: dto, members };
}

export async function listMessages(
  userId: string,
  conversationId: string,
  opts: { before?: number; after?: number; limit?: number },
  client: DbClient = db,
): Promise<{ messages: MessageDTO[]; hasMore: boolean } | null> {
  const member = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) return null;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  let rows: MessageRow[];
  let hasMore = false;
  const include = { sender: { select: liteUser } };
  if (opts.after != null) {
    rows = await client.message.findMany({
      where: { conversationId, seq: { gt: opts.after } },
      orderBy: { seq: "asc" },
      take: limit + 1,
      include,
    });
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit);
  } else {
    rows = await client.message.findMany({
      where: { conversationId, ...(opts.before != null ? { seq: { lt: opts.before } } : {}) },
      orderBy: { seq: "desc" },
      take: limit + 1,
      include,
    });
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit).reverse();
  }

  // 回复引用批量回填
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const replyMap = new Map<string, ReplyRow>();
  if (replyIds.length) {
    const targets = await client.message.findMany({
      where: { id: { in: replyIds } },
      select: { id: true, seq: true, text: true, recalledAt: true, sender: { select: { name: true } } },
    });
    for (const t of targets) replyMap.set(t.id, t as ReplyRow);
  }
  const messages = rows.map((r) => {
    const t = r.replyToId ? replyMap.get(r.replyToId) : undefined;
    const replyTo = t
      ? { id: t.id, seq: t.seq, senderName: t.sender?.name ?? null, text: t.recalledAt ? "" : t.text, recalled: !!t.recalledAt }
      : null;
    return messageDTO(r, replyTo);
  });
  return { messages, hasMore };
}
