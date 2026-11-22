"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { parseInput } from "@/lib/oa/validate";
import { actOnApproval } from "@/lib/services/approval";
import {
  addGroupMembers,
  createGroup,
  getOrCreateDirect,
  leaveGroup,
  markRead,
  recallMessage,
  removeGroupMember,
  renameGroup,
  requireMember,
  sendTextMessage,
  setConversationPrefs,
  transferGroupOwner,
} from "@/lib/im/service";
import { listMessages } from "@/lib/im/queries";

const id = z.string().min(1);

export async function openDirect(userId: string) {
  return runAction(null, async (user) => {
    const target = parseInput(id, userId);
    const conv = await db.$transaction((tx) => getOrCreateDirect(tx, user.id, target));
    return { conversationId: conv.id };
  });
}

const createGroupSchema = z.object({
  name: z.string().trim().max(40, "群名称不能超过 40 字").optional(),
  memberIds: z.array(id).min(1, "至少选择 1 位成员").max(200, "一次最多选择 200 人"),
});

export async function createGroupChat(input: z.input<typeof createGroupSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(createGroupSchema, input);
    const conv = await db.$transaction((tx) => createGroup(tx, user.id, v.name, v.memberIds));
    return { conversationId: conv.id };
  });
}

const sendSchema = z.object({
  conversationId: id,
  clientMsgId: z.string().min(1).max(64),
  content: z.unknown(),
  replyToId: z.string().optional(),
});

export async function sendMessage(input: z.input<typeof sendSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(sendSchema, input);
    const { dto } = await db.$transaction((tx) =>
      sendTextMessage(tx, {
        conversationId: v.conversationId,
        senderId: user.id,
        content: v.content,
        clientMsgId: v.clientMsgId,
        replyToId: v.replyToId ?? null,
      }),
    );
    return dto;
  });
}

export async function recallMessageAction(messageId: string) {
  return runAction(null, async (user) => {
    const mid = parseInput(id, messageId);
    await db.$transaction((tx) => recallMessage(tx, mid, user.id));
  });
}

const readSchema = z.object({ conversationId: id, seq: z.number().int().min(0) });

export async function markConversationRead(input: z.input<typeof readSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(readSchema, input);
    await db.$transaction((tx) => markRead(tx, user.id, v.conversationId, v.seq));
  });
}

const prefsSchema = z.object({
  conversationId: id,
  pinned: z.boolean().optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

export async function updateConversationPrefs(input: z.input<typeof prefsSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(prefsSchema, input);
    await db.$transaction((tx) => setConversationPrefs(tx, user.id, v.conversationId, v));
  });
}

const renameSchema = z.object({ conversationId: id, name: z.string().trim().min(1, "群名称不能为空").max(40, "群名称不能超过 40 字") });

export async function renameGroupChat(input: z.input<typeof renameSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(renameSchema, input);
    await db.$transaction((tx) => renameGroup(tx, v.conversationId, user.id, v.name));
  });
}

const addMembersSchema = z.object({ conversationId: id, memberIds: z.array(id).min(1).max(200) });

export async function addChatMembers(input: z.input<typeof addMembersSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(addMembersSchema, input);
    await db.$transaction((tx) => addGroupMembers(tx, v.conversationId, user.id, v.memberIds));
  });
}

export async function removeChatMember(input: { conversationId: string; userId: string }) {
  return runAction(null, async (user) => {
    const conversationId = parseInput(id, input?.conversationId);
    const userId = parseInput(id, input?.userId);
    await db.$transaction((tx) => removeGroupMember(tx, conversationId, user.id, userId));
  });
}

export async function leaveChat(conversationId: string) {
  return runAction(null, async (user) => {
    const cid = parseInput(id, conversationId);
    await db.$transaction((tx) => leaveGroup(tx, cid, user.id));
  });
}

export async function transferChatOwner(input: { conversationId: string; userId: string }) {
  return runAction(null, async (user) => {
    const conversationId = parseInput(id, input?.conversationId);
    const userId = parseInput(id, input?.userId);
    await db.$transaction((tx) => transferGroupOwner(tx, conversationId, user.id, userId));
  });
}

/** 消息列表（客户端拉取更多历史时用） */
export async function fetchMessages(input: { conversationId: string; before?: number; limit?: number }) {
  return runAction(null, async (user) => {
    const conversationId = parseInput(id, input?.conversationId);
    const res = await listMessages(user.id, conversationId, { before: input?.before, limit: input?.limit });
    if (!res) throw new Error("你不在该会话中");
    return res;
  });
}

const cardActionSchema = z.object({
  messageId: id,
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(1000, "意见不能超过 1000 字").optional(),
});

/** 审批卡片上的「同意 / 驳回」 */
export async function cardAction(input: z.input<typeof cardActionSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(cardActionSchema, input);
    if (v.action === "reject" && !v.comment?.trim()) throw new Error("驳回时请填写意见");
    const msg = await db.message.findUnique({ where: { id: v.messageId }, select: { type: true, refType: true, refId: true, conversationId: true } });
    if (!msg || msg.type !== "CARD" || msg.refType !== "approval" || !msg.refId) throw new Error("该卡片不支持操作");
    await requireMember(db, msg.conversationId, user.id);
    const task = await db.approvalTask.findFirst({
      where: { instanceId: msg.refId, approverId: user.id, status: "PENDING" },
    });
    if (!task) throw new Error("你没有待处理的审批任务，可能已被处理");
    const instance = await db.$transaction((tx) =>
      actOnApproval(tx, {
        taskId: task.id,
        userId: user.id,
        action: v.action === "approve" ? "APPROVE" : "REJECT",
        comment: v.comment,
      }),
    );
    revalidatePath(`/oa/approvals/${instance.id}`);
    revalidatePath("/oa/approvals");
    if (instance.bizType === "purchase_order" && instance.bizId) revalidatePath(`/erp/purchase/${instance.bizId}`);
    return { status: instance.status };
  });
}
