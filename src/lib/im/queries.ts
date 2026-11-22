import type { Conversation, ConversationMember, Message, User } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";
import { BIZ_META, isBizType } from "./biz-meta";
import { BOTS, type BotKey } from "./bots";
import type { ConversationDTO, MessageDTO, MessageSearchHit, ReactionGroup, UserLite } from "./types";

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
  info: { memberCount: number; peer?: Pick<User, "id" | "name" | "avatarColor"> | null; peerLastReadSeq?: number | null },
  lastMessage: (Message & { sender?: Pick<User, "name"> | null }) | null,
): ConversationDTO {
  const me = member;
  let name = conv.name ?? "群聊";
  let avatarColor = groupColor(conv.id);
  let peerId: string | null = null;
  let peerLastReadSeq: number | null = null;
  if (conv.type === "DIRECT") {
    peerId = info.peer?.id ?? null;
    peerLastReadSeq = info.peerLastReadSeq ?? 0;
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
    peerLastReadSeq,
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

export function messageDTO(
  msg: MessageRow,
  replyTo: MessageDTO["replyTo"],
  extra?: { reactions?: ReactionGroup[]; threadParticipants?: UserLite[] },
): MessageDTO {
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
    editedAt: recalled ? null : (msg.editedAt?.toISOString() ?? null),
    reactions: recalled ? [] : (extra?.reactions ?? []),
    threadRootId: msg.threadRootId ?? null,
    threadCount: msg.threadCount ?? 0,
    threadLastAt: msg.threadLastAt?.toISOString() ?? null,
    threadParticipants: extra?.threadParticipants ?? [],
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function hydrateMessages(client: DbClient, rows: MessageRow[]): Promise<MessageDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const threadRoots = rows.filter((r) => r.threadCount > 0 && !r.threadRootId).map((r) => r.id);

  const [replyTargets, reactionRows, threadReplyRows] = await Promise.all([
    replyIds.length
      ? client.message.findMany({
          where: { id: { in: replyIds } },
          select: { id: true, seq: true, text: true, recalledAt: true, sender: { select: { name: true } } },
        })
      : Promise.resolve([]),
    client.messageReaction.findMany({
      where: { messageId: { in: ids } },
      orderBy: { createdAt: "asc" },
      include: { user: { select: liteUser } },
    }),
    threadRoots.length
      ? client.message.findMany({
          where: { threadRootId: { in: threadRoots }, recalledAt: null, senderId: { not: null } },
          orderBy: { seq: "desc" },
          select: { threadRootId: true, sender: { select: liteUser } },
          take: threadRoots.length * 10,
        })
      : Promise.resolve([]),
  ]);

  const replyMap = new Map<string, ReplyRow>();
  for (const t of replyTargets) replyMap.set(t.id, t as ReplyRow);

  const reactionMap = new Map<string, ReactionGroup[]>();
  for (const r of reactionRows) {
    let groups = reactionMap.get(r.messageId);
    if (!groups) {
      groups = [];
      reactionMap.set(r.messageId, groups);
    }
    let g = groups.find((x) => x.emoji === r.emoji);
    if (!g) {
      g = { emoji: r.emoji, users: [] };
      groups.push(g);
    }
    g.users.push({ id: r.user.id, name: r.user.name, avatarColor: r.user.avatarColor });
  }

  const participantMap = new Map<string, UserLite[]>();
  for (const tr of threadReplyRows) {
    if (!tr.threadRootId || !tr.sender) continue;
    let list = participantMap.get(tr.threadRootId);
    if (!list) {
      list = [];
      participantMap.set(tr.threadRootId, list);
    }
    if (list.length < 3 && !list.some((u) => u.id === tr.sender!.id)) {
      list.push({ id: tr.sender.id, name: tr.sender.name, avatarColor: tr.sender.avatarColor });
    }
  }

  return rows.map((r) => {
    const t = r.replyToId ? replyMap.get(r.replyToId) : undefined;
    const replyTo = t
      ? { id: t.id, seq: t.seq, senderName: t.sender?.name ?? null, text: t.recalledAt ? "" : t.text, recalled: !!t.recalledAt }
      : null;
    return messageDTO(r, replyTo, {
      reactions: reactionMap.get(r.id) ?? [],
      threadParticipants: participantMap.get(r.id) ?? [],
    });
  });
}

export async function toMessageDTO(client: DbClient, msg: MessageRow): Promise<MessageDTO> {
  const [dto] = await hydrateMessages(client, [msg]);
  return dto;
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
  const list = rows.map((m) => {
    const peerMember = m.conversation.members[0];
    return {
      member: m,
      conv: m.conversation,
      dto: toConversationDTO(
        m,
        m.conversation,
        {
          memberCount: m.conversation._count.members,
          peer: peerMember?.user ?? null,
          peerLastReadSeq: peerMember?.lastReadSeq ?? null,
        },
        m.conversation.messages[0] ?? null,
      ),
    };
  });
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
): Promise<{ conversation: ConversationDTO; members: (UserLite & { role: string; lastReadSeq: number })[] | null } | null> {
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
  const peerMember = conv.members.find((m) => m.userId !== userId) ?? null;
  const dto = toConversationDTO(
    member,
    conv,
    {
      memberCount: conv.members.length,
      peer: peerMember?.user ?? null,
      peerLastReadSeq: peerMember?.lastReadSeq ?? null,
    },
    conv.messages[0] ?? null,
  );
  const members =
    conv.type === "GROUP"
      ? conv.members.map((m) => ({
          id: m.user!.id,
          name: m.user!.name,
          avatarColor: m.user!.avatarColor,
          role: m.role,
          lastReadSeq: m.lastReadSeq,
        }))
      : null;
  return { conversation: dto, members };
}

export async function listMessages(
  userId: string,
  conversationId: string,
  opts: { before?: number; after?: number; around?: number; limit?: number },
  client: DbClient = db,
): Promise<{ messages: MessageDTO[]; hasMore: boolean; hasNewer?: boolean } | null> {
  const member = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) return null;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const include = { sender: { select: liteUser } };

  let rows: MessageRow[];
  let hasMore = false;
  let hasNewer = false;

  if (opts.around != null) {
    const half = Math.max(10, Math.floor(limit / 2));
    const [older, newer] = await Promise.all([
      client.message.findMany({
        where: { conversationId, threadRootId: null, seq: { lte: opts.around } },
        orderBy: { seq: "desc" },
        take: half + 1,
        include,
      }),
      client.message.findMany({
        where: { conversationId, threadRootId: null, seq: { gt: opts.around } },
        orderBy: { seq: "asc" },
        take: half + 1,
        include,
      }),
    ]);
    hasMore = older.length > half;
    hasNewer = newer.length > half;
    rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half)];
  } else if (opts.after != null) {
    // 增量同步包含主消息与话题消息，确保 seq 连续无缺口
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
      where: { conversationId, threadRootId: null, ...(opts.before != null ? { seq: { lt: opts.before } } : {}) },
      orderBy: { seq: "desc" },
      take: limit + 1,
      include,
    });
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit).reverse();
  }

  const messages = await hydrateMessages(client, rows);
  return { messages, hasMore, ...(opts.around != null ? { hasNewer } : {}) };
}

export async function listThreadMessages(
  userId: string,
  conversationId: string,
  rootId: string,
  opts: { before?: number; limit?: number } = {},
  client: DbClient = db,
): Promise<{ root: MessageDTO; messages: MessageDTO[]; hasMore: boolean } | null> {
  const member = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) return null;
  const include = { sender: { select: liteUser } };
  const rootRow = await client.message.findUnique({ where: { id: rootId }, include });
  if (!rootRow || rootRow.conversationId !== conversationId || rootRow.threadRootId) return null;

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const raw = await client.message.findMany({
    where: { conversationId, threadRootId: rootId, ...(opts.before != null ? { seq: { lt: opts.before } } : {}) },
    orderBy: { seq: "desc" },
    take: limit + 1,
    include,
  });
  const hasMore = raw.length > limit;
  const replyRows = raw.slice(0, limit).reverse();

  const [root, ...messages] = await hydrateMessages(client, [rootRow, ...replyRows]);
  return { root, messages, hasMore };
}

export async function searchConversationMessages(
  userId: string,
  conversationId: string,
  opts: { q?: string; kind?: "all" | "image" | "file" | "link"; senderId?: string; before?: number; limit?: number },
  client: DbClient = db,
): Promise<{ items: MessageSearchHit[]; hasMore: boolean } | null> {
  const member = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) return null;
  const q = (opts.q ?? "").trim().slice(0, 100);
  const kind = opts.kind ?? "all";
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);

  const where: Record<string, unknown> = {
    conversationId,
    recalledAt: null,
    type: { not: "SYSTEM" },
  };
  if (opts.before != null) where.seq = { lt: opts.before };
  if (opts.senderId) where.senderId = opts.senderId;
  if (kind === "image") where.type = "IMAGE";
  else if (kind === "file") where.type = "FILE";
  else if (kind === "link") {
    where.OR = [
      { links: { not: "[]" } },
      { text: { contains: "http://" } },
      { text: { contains: "https://" } },
    ];
  }
  if (q) where.text = { contains: q };

  const raw = await client.message.findMany({
    where,
    orderBy: { seq: "desc" },
    take: limit + 1,
    include: { sender: { select: liteUser } },
  });
  const hasMore = raw.length > limit;
  const items: MessageSearchHit[] = raw.slice(0, limit).map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq,
    type: m.type,
    text: m.text,
    sender: m.sender ? { id: m.sender.id, name: m.sender.name, avatarColor: m.sender.avatarColor } : null,
    threadRootId: m.threadRootId ?? null,
    createdAt: m.createdAt.toISOString(),
  }));
  return { items, hasMore };
}

export async function getMessageReceipts(
  userId: string,
  conversationId: string,
  seq: number,
  client: DbClient = db,
): Promise<{ read: UserLite[]; unread: UserLite[] } | null> {
  const member = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) return null;
  const [msg, members] = await Promise.all([
    client.message.findUnique({
      where: { conversationId_seq: { conversationId, seq } },
      select: { senderId: true },
    }),
    client.conversationMember.findMany({
      where: { conversationId },
      include: { user: { select: liteUser } },
      orderBy: { joinedAt: "asc" },
    }),
  ]);
  const senderId = msg?.senderId ?? null;
  const read: UserLite[] = [];
  const unread: UserLite[] = [];
  for (const m of members) {
    if (m.userId === senderId) continue;
    const lite: UserLite = { id: m.user.id, name: m.user.name, avatarColor: m.user.avatarColor };
    if (m.lastReadSeq >= seq) read.push(lite);
    else unread.push(lite);
  }
  return { read, unread };
}
