import type { Conversation, ConversationMember, Message, User } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import { queuePushClear, queueMessagePush } from "@/lib/push/dispatch";
import { queueEvent } from "@/lib/realtime/buffer";
import { SAFE_INLINE_IMAGES } from "@/lib/storage";
import { REF_LABEL } from "./biz-meta";
import { extractLinks, parseMessageContent } from "./content";
import { conversationUserIds, toMessageDTO, userLiteSelect } from "./queries";
import { resolveRefs } from "./refs";
import type { BotKey } from "./bots";
import type { Card, FileContent, ImageContent, MessageDTO, MessageKind, RefType } from "./types";

const RECALL_WINDOW_MS = 2 * 60 * 1000;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type MemberWithUser = ConversationMember & { user: Pick<User, "id" | "name" | "avatarColor"> };
type MessageWithSender = Message & { sender?: Pick<User, "id" | "name" | "avatarColor"> | null };

export async function requireMember(client: DbClient, conversationId: string, userId: string): Promise<ConversationMember> {
  const member = await client.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!member) throw new Error("你不在该会话中");
  return member;
}

async function requireGroup(client: DbClient, conversationId: string): Promise<Conversation> {
  const conv = await client.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw new Error("会话不存在");
  if (conv.type !== "GROUP") throw new Error("仅群聊支持该操作");
  return conv;
}

async function validateThreadRoot(client: DbClient, conversationId: string, threadRootId: string) {
  const root = await client.message.findUnique({
    where: { id: threadRootId },
    select: { conversationId: true, threadRootId: true, type: true, recalledAt: true },
  });
  if (!root || root.conversationId !== conversationId) throw new Error("话题根消息不存在");
  if (root.threadRootId) throw new Error("暂不支持在话题回复中再创建子话题");
  if (root.type === "SYSTEM" || root.recalledAt) throw new Error("该消息不支持发起话题");
}

export type AppendMessageInput = {
  conversationId: string;
  senderId: string | null;
  type: MessageKind;
  /** 结构化内容：Tiptap doc | Card | {text} | ImageContent | FileContent（将被 JSON.stringify 存储） */
  content: unknown;
  text: string;
  mentions?: string[];
  links?: { type: RefType; id: string }[];
  refType?: string | null;
  refId?: string | null;
  clientMsgId?: string | null;
  replyToId?: string | null;
  threadRootId?: string | null;
  /** 仅种子/回填使用，默认 now() */
  createdAt?: Date;
  /** 发送后将其 lastReadSeq 推进到新 seq（默认 senderId；系统消息传操作者，机器人卡片传 null 表示无人已读） */
  readBy?: string | null;
};

/** 追加消息：原子分配 seq、更新会话摘要、唤醒隐藏成员、派发 message.new（幂等 clientMsgId） */
export async function appendMessage(
  client: DbClient,
  input: AppendMessageInput,
): Promise<{ message: Message; dto: MessageDTO; created: boolean }> {
  if (input.senderId && input.clientMsgId) {
    const dup = await client.message.findFirst({
      where: { conversationId: input.conversationId, senderId: input.senderId, clientMsgId: input.clientMsgId },
      include: { sender: { select: userLiteSelect } },
    });
    if (dup) return { message: dup, dto: await toMessageDTO(client, dup), created: false };
  }
  try {
    const now = input.createdAt ?? new Date();
    const conv = await client.conversation.update({
      where: { id: input.conversationId },
      data: { lastSeq: { increment: 1 }, lastMessageAt: now },
      select: { lastSeq: true },
    });
    const msg = (await client.message.create({
      data: {
        conversationId: input.conversationId,
        seq: conv.lastSeq,
        senderId: input.senderId,
        clientMsgId: input.clientMsgId ?? null,
        type: input.type,
        content: JSON.stringify(input.content),
        text: input.text,
        mentions: JSON.stringify(input.mentions ?? []),
        links: JSON.stringify(input.links ?? []),
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        replyToId: input.replyToId ?? null,
        threadRootId: input.threadRootId ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
      include: { sender: { select: userLiteSelect } },
    })) as MessageWithSender;
    await client.conversationMember.updateMany({
      where: { conversationId: input.conversationId, hidden: true },
      data: { hidden: false },
    });
    // 发送者/操作者自己的消息不产生未读
    const readBy = input.readBy === undefined ? input.senderId : input.readBy;
    if (readBy) {
      await client.conversationMember.updateMany({
        where: { conversationId: input.conversationId, userId: readBy, lastReadSeq: { lt: msg.seq } },
        data: { lastReadSeq: msg.seq },
      });
      // 在电脑上回复后，手机上该会话的提醒随之撤掉
      queuePushClear(readBy, input.conversationId, msg.seq);
    }
    const dto = await toMessageDTO(client, msg);
    const ids = await conversationUserIds(client, input.conversationId);
    queueEvent(ids, { type: "message.new", conversationId: input.conversationId, message: dto });
    if (!input.createdAt) await queueMessagePush(client, input.conversationId, dto, input.senderId);

    // 若为话题回复：更新根消息回复计数与最后回复时间，并推送根消息刷新事件
    if (input.threadRootId) {
      const updatedRoot = (await client.message.update({
        where: { id: input.threadRootId },
        data: { threadCount: { increment: 1 }, threadLastAt: now },
        include: { sender: { select: userLiteSelect } },
      })) as MessageWithSender;
      const rootDto = await toMessageDTO(client, updatedRoot);
      queueEvent(ids, { type: "message.updated", conversationId: input.conversationId, message: rootDto });
    }
    return { message: msg, dto, created: true };
  } catch (e) {
    // 并发下同 clientMsgId 撞唯一索引：返回已存在消息
    if (input.senderId && input.clientMsgId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await client.message.findFirst({
        where: { conversationId: input.conversationId, senderId: input.senderId, clientMsgId: input.clientMsgId },
        include: { sender: { select: userLiteSelect } },
      });
      if (dup) return { message: dup, dto: await toMessageDTO(client, dup), created: false };
    }
    throw e;
  }
}

async function systemMessage(client: DbClient, conversationId: string, text: string, opts?: { createdAt?: Date; readBy?: string | null }) {
  return appendMessage(client, {
    conversationId,
    senderId: null,
    type: "SYSTEM",
    content: { text },
    text,
    ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
    ...(opts?.readBy !== undefined ? { readBy: opts.readBy } : {}),
  });
}

function directKeyOf(a: string, b: string) {
  return [a, b].sort().join(":");
}

export async function getOrCreateDirect(client: DbClient, a: string, b: string): Promise<Conversation> {
  if (a === b) throw new Error("不能和自己发起单聊");
  const directKey = directKeyOf(a, b);
  const existing = await client.conversation.findUnique({ where: { directKey } });
  if (existing) return existing;
  const count = await client.user.count({ where: { id: { in: [a, b] }, active: true } });
  if (count !== 2) throw new Error("用户不存在或已停用");
  try {
    return await client.conversation.create({
      data: {
        type: "DIRECT",
        directKey,
        members: { create: [{ userId: a }, { userId: b }] },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const conv = await client.conversation.findUnique({ where: { directKey } });
      if (conv) return conv;
    }
    throw e;
  }
}

/** 每个用户每个机器人一个会话，单成员；directKey "bot:<key>:<uid>" 兜底并发 P2002 */
export async function getOrCreateBotConversation(client: DbClient, userId: string, botKey: BotKey): Promise<Conversation> {
  const directKey = `bot:${botKey}:${userId}`;
  const existing = await client.conversation.findUnique({ where: { directKey } });
  if (existing) return existing;
  // 兼容早期无 directKey 的机器人会话：命中则补键
  const legacy = await client.conversation.findFirst({
    where: { type: "BOT", botKey, directKey: null, members: { some: { userId } } },
  });
  if (legacy) {
    try {
      return await client.conversation.update({ where: { id: legacy.id }, data: { directKey } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const conv = await client.conversation.findUnique({ where: { directKey } });
        if (conv) return conv;
      }
      return legacy;
    }
  }
  try {
    return await client.conversation.create({
      data: { type: "BOT", botKey, directKey, members: { create: [{ userId }] } },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const conv = await client.conversation.findUnique({ where: { directKey } });
      if (conv) return conv;
    }
    throw e;
  }
}

export async function createGroup(client: DbClient, ownerId: string, name: string | undefined, memberIds: string[]): Promise<Conversation> {
  const others = [...new Set(memberIds.filter((id) => id !== ownerId))];
  if (!others.length) throw new Error("群聊至少需要选择 1 位其他成员");
  const users = await client.user.findMany({ where: { id: { in: [ownerId, ...others] }, active: true }, select: userLiteSelect });
  if (users.length !== others.length + 1) throw new Error("有成员不存在或已停用");
  const owner = users.find((u) => u.id === ownerId)!;
  const trimmed = (name ?? "").trim().slice(0, 40);
  const groupName =
    trimmed || others
      .map((id) => users.find((u) => u.id === id)?.name)
      .filter(Boolean)
      .slice(0, 3)
      .join("、");
  const conv = await client.conversation.create({
    data: {
      type: "GROUP",
      name: groupName,
      ownerId,
      members: { create: [{ userId: ownerId, role: "OWNER" }, ...others.map((userId) => ({ userId }))] },
    },
  });
  await systemMessage(client, conv.id, `${owner.name} 创建了群聊`, { readBy: ownerId });
  return conv;
}

// ── 群管理 ──

export async function renameGroup(client: DbClient, conversationId: string, actorId: string, name: string) {
  await requireMember(client, conversationId, actorId);
  const conv = await requireGroup(client, conversationId);
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error("群名称不能为空");
  if (trimmed === conv.name) return;
  const user = await client.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } });
  await client.conversation.update({ where: { id: conversationId }, data: { name: trimmed } });
  await systemMessage(client, conversationId, `${user.name} 将群聊名称改为「${trimmed}」`, { readBy: actorId });
  queueEvent(await conversationUserIds(client, conversationId), { type: "conversation.updated", conversationId });
}

export async function addGroupMembers(client: DbClient, conversationId: string, actorId: string, userIds: string[]) {
  await requireMember(client, conversationId, actorId);
  await requireGroup(client, conversationId);
  const existing = new Set(await conversationUserIds(client, conversationId));
  const ids = [...new Set(userIds)].filter((id) => !existing.has(id));
  if (!ids.length) throw new Error("所选成员已在群聊中");
  const users = await client.user.findMany({ where: { id: { in: ids }, active: true }, select: userLiteSelect });
  if (users.length !== ids.length) throw new Error("有成员不存在或已停用");
  await client.conversationMember.createMany({ data: ids.map((userId) => ({ conversationId, userId })) });
  const actor = await client.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } });
  const names = users.map((u) => u.name).join("、");
  await systemMessage(client, conversationId, `${actor.name} 邀请 ${names} 加入群聊`, { readBy: actorId });
  queueEvent(ids, { type: "conversation.updated", conversationId });
}

export async function removeGroupMember(client: DbClient, conversationId: string, actorId: string, targetId: string) {
  const actor = await requireMember(client, conversationId, actorId);
  await requireGroup(client, conversationId);
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") throw new Error("只有群主或管理员可以移除成员");
  const target = await client.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: targetId } } });
  if (!target) throw new Error("成员不在群聊中");
  if (target.role === "OWNER") throw new Error("不能移除群主");
  const [a, t] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } }),
    client.user.findUniqueOrThrow({ where: { id: targetId }, select: { name: true } }),
  ]);
  await client.conversationMember.delete({ where: { conversationId_userId: { conversationId, userId: targetId } } });
  await systemMessage(client, conversationId, `${a.name} 将 ${t.name} 移出群聊`, { readBy: actorId });
  queueEvent([targetId], { type: "conversation.removed", conversationId });
}

export async function leaveGroup(client: DbClient, conversationId: string, userId: string) {
  const member = await requireMember(client, conversationId, userId);
  await requireGroup(client, conversationId);
  const count = await client.conversationMember.count({ where: { conversationId } });
  if (member.role === "OWNER" && count > 1) throw new Error("群主退出前请先转让群主");
  const user = await client.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  await client.conversationMember.delete({ where: { conversationId_userId: { conversationId, userId } } });
  queueEvent([userId], { type: "conversation.removed", conversationId });
  if (count <= 1) {
    await client.conversation.delete({ where: { id: conversationId } });
    return;
  }
  await systemMessage(client, conversationId, `${user.name} 退出了群聊`, { readBy: userId });
  queueEvent(await conversationUserIds(client, conversationId), { type: "conversation.updated", conversationId });
}

export async function transferGroupOwner(client: DbClient, conversationId: string, actorId: string, targetId: string) {
  const actor = await requireMember(client, conversationId, actorId);
  await requireGroup(client, conversationId);
  if (actor.role !== "OWNER") throw new Error("只有群主可以转让");
  await requireMember(client, conversationId, targetId);
  if (targetId === actorId) throw new Error("不能转让给自己");
  await client.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: targetId } }, data: { role: "OWNER" } });
  await client.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: actorId } }, data: { role: "MEMBER" } });
  await client.conversation.update({ where: { id: conversationId }, data: { ownerId: targetId } });
  const [a, t] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } }),
    client.user.findUniqueOrThrow({ where: { id: targetId }, select: { name: true } }),
  ]);
  await systemMessage(client, conversationId, `${a.name} 将群主转让给 ${t.name}`, { readBy: actorId });
  queueEvent(await conversationUserIds(client, conversationId), { type: "conversation.updated", conversationId });
}

// ── 消息操作 ──

export async function sendTextMessage(
  client: DbClient,
  input: {
    conversationId: string;
    senderId: string;
    content: unknown;
    clientMsgId?: string | null;
    replyToId?: string | null;
    threadRootId?: string | null;
  },
): Promise<{ message: Message; dto: MessageDTO; created: boolean }> {
  const conv = await client.conversation.findUnique({ where: { id: input.conversationId }, select: { type: true } });
  if (!conv) throw new Error("会话不存在");
  await requireMember(client, input.conversationId, input.senderId);
  if (conv.type === "BOT") throw new Error("机器人会话不能回复");
  if (input.replyToId) {
    const target = await client.message.findUnique({ where: { id: input.replyToId }, select: { conversationId: true } });
    if (!target || target.conversationId !== input.conversationId) throw new Error("回复的消息不存在");
  }
  if (input.threadRootId) {
    await validateThreadRoot(client, input.conversationId, input.threadRootId);
  }
  const parsed = parseMessageContent(input.content);
  return appendMessage(client, {
    conversationId: input.conversationId,
    senderId: input.senderId,
    type: "TEXT",
    content: parsed.content,
    text: parsed.text,
    mentions: parsed.mentions,
    links: parsed.links,
    clientMsgId: input.clientMsgId ?? null,
    replyToId: input.replyToId ?? null,
    threadRootId: input.threadRootId ?? null,
  });
}

export async function sendAttachmentMessage(
  client: DbClient,
  input: {
    conversationId: string;
    senderId: string;
    attachmentId: string;
    clientMsgId?: string | null;
    replyToId?: string | null;
    threadRootId?: string | null;
  },
): Promise<{ message: Message; dto: MessageDTO; created: boolean }> {
  const conv = await client.conversation.findUnique({ where: { id: input.conversationId }, select: { type: true } });
  if (!conv) throw new Error("会话不存在");
  await requireMember(client, input.conversationId, input.senderId);
  if (conv.type === "BOT") throw new Error("机器人会话不能发送附件");
  if (input.replyToId) {
    const target = await client.message.findUnique({ where: { id: input.replyToId }, select: { conversationId: true } });
    if (!target || target.conversationId !== input.conversationId) throw new Error("回复的消息不存在");
  }
  if (input.threadRootId) {
    await validateThreadRoot(client, input.conversationId, input.threadRootId);
  }
  const att = await client.attachment.findUnique({ where: { id: input.attachmentId } });
  if (!att) throw new Error("附件不存在");
  if (att.uploaderId !== input.senderId || att.conversationId !== input.conversationId) {
    throw new Error("无权发送该附件");
  }
  const isImage = SAFE_INLINE_IMAGES.has(att.mimeType);
  const url = `/api/im/files/${att.id}`;
  if (isImage) {
    const content: ImageContent = {
      attachmentId: att.id,
      url,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      width: att.width,
      height: att.height,
    };
    return appendMessage(client, {
      conversationId: input.conversationId,
      senderId: input.senderId,
      type: "IMAGE",
      content,
      text: "[图片]",
      clientMsgId: input.clientMsgId ?? null,
      replyToId: input.replyToId ?? null,
      threadRootId: input.threadRootId ?? null,
    });
  }
  const content: FileContent = {
    attachmentId: att.id,
    url,
    filename: att.filename,
    mimeType: att.mimeType,
    size: att.size,
  };
  return appendMessage(client, {
    conversationId: input.conversationId,
    senderId: input.senderId,
    type: "FILE",
    content,
    text: `[文件] ${att.filename}`,
    clientMsgId: input.clientMsgId ?? null,
    replyToId: input.replyToId ?? null,
    threadRootId: input.threadRootId ?? null,
  });
}

export function buildPlainTiptapDoc(text: string) {
  const lines = text.split("\n");
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

/**
 * Webhook 机器人回复：以机器人影子账号身份向其所在会话发消息（纯文本或通用卡片）。
 * 必须在事务内调用；clientMsgId 用于外部重试幂等。
 */
export async function sendBotReplyMessage(
  client: DbClient,
  input: {
    conversationId: string;
    botUserId: string;
    text?: string | null;
    card?: Card | null;
    clientMsgId?: string | null;
    replyToId?: string | null;
    threadRootId?: string | null;
  },
): Promise<{ message: Message; dto: MessageDTO; created: boolean }> {
  const conv = await client.conversation.findUnique({ where: { id: input.conversationId }, select: { type: true } });
  if (!conv) throw new Error("会话不存在");
  await requireMember(client, input.conversationId, input.botUserId);
  if (conv.type === "BOT") throw new Error("机器人会话不能回复");
  if (input.replyToId) {
    const target = await client.message.findUnique({ where: { id: input.replyToId }, select: { conversationId: true } });
    if (!target || target.conversationId !== input.conversationId) throw new Error("回复的消息不存在");
  }
  if (input.threadRootId) {
    await validateThreadRoot(client, input.conversationId, input.threadRootId);
  }
  const base = {
    conversationId: input.conversationId,
    senderId: input.botUserId,
    clientMsgId: input.clientMsgId ?? null,
    replyToId: input.replyToId ?? null,
    threadRootId: input.threadRootId ?? null,
  };
  if (input.card) {
    const card: Card = { ...input.card, template: "generic", actions: [] };
    const text = [card.title, card.body].filter(Boolean).join("\n").slice(0, 5000);
    return appendMessage(client, { ...base, type: "CARD", content: card, text, links: card.ref ? [card.ref] : [] });
  }
  const text = (input.text ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new Error("消息不能为空");
  if (text.length > 5000) throw new Error("消息不能超过 5000 字");
  return appendMessage(client, {
    ...base,
    type: "TEXT",
    content: buildPlainTiptapDoc(text),
    text,
    links: extractLinks(text),
  });
}

/**
 * 从业务页面直接分享文档/审批等对象到指定会话或指定同事：
 * - 先校验分享人自身拥有该对象的查看权限；
 * - 实际以带 links 的 TEXT 消息发送，接收端通过 RefPreviewCard 按「查看者本人权限」动态渲染，防止敏感信息越权泄露。
 */
export async function shareRefMessage(
  client: DbClient,
  actor: { id: string; permissions: string[] },
  input: {
    conversationId?: string | null;
    targetUserId?: string | null;
    refType: RefType;
    refId: string;
    note?: string | null;
    clientMsgId?: string | null;
  },
): Promise<{ conversationId: string; dto: MessageDTO }> {
  const [preview] = await resolveRefs(actor, [{ type: input.refType, id: input.refId }], client);
  if (!preview || !preview.ok) {
    throw new Error(preview?.reason === "forbidden" ? "你无权分享该内容" : "要分享的内容不存在");
  }

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const conv = await client.conversation.findUnique({ where: { id: conversationId }, select: { type: true } });
    if (!conv) throw new Error("会话不存在");
    if (conv.type === "BOT") throw new Error("不能分享到机器人会话");
    await requireMember(client, conversationId, actor.id);
  } else if (input.targetUserId) {
    const conv = await getOrCreateDirect(client, actor.id, input.targetUserId);
    conversationId = conv.id;
  } else {
    throw new Error("请选择要分享的会话或成员");
  }

  const trimmedNote = (input.note ?? "").trim().slice(0, 1000);
  const text = trimmedNote || `分享了${REF_LABEL[input.refType] ?? "内容"}`;
  const { dto } = await appendMessage(client, {
    conversationId,
    senderId: actor.id,
    type: "TEXT",
    content: buildPlainTiptapDoc(text),
    text,
    links: [{ type: input.refType, id: input.refId }],
    refType: input.refType,
    refId: input.refId,
    clientMsgId: input.clientMsgId ?? null,
  });
  return { conversationId, dto };
}

export async function editMessage(
  client: DbClient,
  input: { messageId: string; userId: string; content: unknown },
): Promise<MessageDTO> {
  const msg = await client.message.findUnique({ where: { id: input.messageId }, include: { sender: { select: userLiteSelect } } });
  if (!msg) throw new Error("消息不存在");
  await requireMember(client, msg.conversationId, input.userId);
  if (msg.senderId !== input.userId) throw new Error("只能编辑自己发送的消息");
  if (msg.type !== "TEXT") throw new Error("仅文本消息支持编辑");
  if (msg.recalledAt) throw new Error("已撤回的消息不能编辑");
  if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) throw new Error("超过 24 小时的消息不能编辑");

  const parsed = parseMessageContent(input.content);
  const updated = await client.message.update({
    where: { id: input.messageId },
    data: {
      content: JSON.stringify(parsed.content),
      text: parsed.text,
      mentions: JSON.stringify(parsed.mentions),
      links: JSON.stringify(parsed.links),
      editedAt: new Date(),
    },
    include: { sender: { select: userLiteSelect } },
  });
  const dto = await toMessageDTO(client, updated);
  queueEvent(await conversationUserIds(client, msg.conversationId), {
    type: "message.updated",
    conversationId: msg.conversationId,
    message: dto,
  });
  return dto;
}

export async function toggleReaction(
  client: DbClient,
  input: { messageId: string; userId: string; emoji: string },
): Promise<{ message: MessageDTO; added: boolean }> {
  const emoji = input.emoji.trim();
  if (!emoji || emoji.length > 16) throw new Error("无效的表情");
  const msg = await client.message.findUnique({ where: { id: input.messageId }, include: { sender: { select: userLiteSelect } } });
  if (!msg) throw new Error("消息不存在");
  await requireMember(client, msg.conversationId, input.userId);
  if (msg.type === "SYSTEM" || msg.recalledAt) throw new Error("该消息不支持表情回应");

  const key = { messageId: msg.id, userId: input.userId, emoji };
  const existing = await client.messageReaction.findUnique({ where: { messageId_userId_emoji: key } });
  let added = false;
  if (existing) {
    await client.messageReaction.delete({ where: { messageId_userId_emoji: key } });
  } else {
    try {
      await client.messageReaction.create({ data: key });
      added = true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  const dto = await toMessageDTO(client, msg);
  queueEvent(await conversationUserIds(client, msg.conversationId), {
    type: "message.updated",
    conversationId: msg.conversationId,
    message: dto,
  });
  return { message: dto, added };
}

export async function recallMessage(client: DbClient, messageId: string, userId: string) {
  const msg = await client.message.findUnique({ where: { id: messageId }, include: { sender: { select: userLiteSelect } } });
  if (!msg) throw new Error("消息不存在");
  await requireMember(client, msg.conversationId, userId);
  if (msg.senderId !== userId) throw new Error("只能撤回自己发送的消息");
  if (msg.type !== "TEXT" && msg.type !== "IMAGE" && msg.type !== "FILE") throw new Error("该类型消息不支持撤回");
  if (msg.recalledAt) return;
  if (Date.now() - msg.createdAt.getTime() > RECALL_WINDOW_MS) throw new Error("超过 2 分钟的消息不能撤回");
  const updated = await client.message.update({
    where: { id: messageId },
    data: { recalledAt: new Date() },
    include: { sender: { select: userLiteSelect } },
  });
  const dto = await toMessageDTO(client, updated);
  queueEvent(await conversationUserIds(client, msg.conversationId), {
    type: "message.updated",
    conversationId: msg.conversationId,
    message: dto,
  });
}

export async function markRead(client: DbClient, userId: string, conversationId: string, seq: number) {
  const member = await requireMember(client, conversationId, userId);
  const conv = await client.conversation.findUnique({ where: { id: conversationId }, select: { lastSeq: true, type: true } });
  if (!conv) throw new Error("会话不存在");
  const next = Math.min(Math.max(0, seq), conv.lastSeq);
  if (next <= member.lastReadSeq) return;
  await client.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadSeq: next },
  });
  const recipients = conv.type === "BOT" ? [userId] : await conversationUserIds(client, conversationId);
  queueEvent(recipients, { type: "read", conversationId, userId, seq: next });
  queuePushClear(userId, conversationId, next);
}

export async function setConversationPrefs(
  client: DbClient,
  userId: string,
  conversationId: string,
  prefs: { pinned?: boolean; muted?: boolean; hidden?: boolean },
) {
  await requireMember(client, conversationId, userId);
  const data: Record<string, boolean> = {};
  if (prefs.pinned !== undefined) data.pinned = prefs.pinned;
  if (prefs.muted !== undefined) data.muted = prefs.muted;
  if (prefs.hidden !== undefined) data.hidden = prefs.hidden;
  if (!Object.keys(data).length) return;
  await client.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data });
  queueEvent([userId], { type: "conversation.updated", conversationId });
}
