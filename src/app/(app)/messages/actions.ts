"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { parseInput } from "@/lib/oa/validate";
import { actOnApproval } from "@/lib/services/approval";
import {
  addGroupMembers,
  createGroup,
  editMessage,
  getOrCreateDirect,
  leaveGroup,
  markRead,
  recallMessage,
  removeGroupMember,
  renameGroup,
  requireMember,
  sendAttachmentMessage,
  sendTextMessage,
  setConversationPrefs,
  shareRefMessage,
  toggleReaction,
  transferGroupOwner,
} from "@/lib/im/service";
import { getOrCreateBizGroup } from "@/lib/im/biz";
import { listMessages } from "@/lib/im/queries";
import { dispatchMessageWebhooks } from "@/lib/im/webhook-outbound";
import {
  listConversationWebhookBots,
  resetConversationRunConfig,
  runConfigPatchSchema,
  saveConversationRunConfig,
} from "@/lib/im/webhook-run-config";

const id = z.string().min(1);

/** 事务提交后在响应结束后投递 Webhook，不阻塞也不影响发送结果 */
function scheduleWebhooks(messageId: string, created: boolean) {
  if (!created) return;
  after(() => dispatchMessageWebhooks(messageId).then(() => undefined));
}

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
  threadRootId: z.string().optional(),
});

export async function sendMessage(input: z.input<typeof sendSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(sendSchema, input);
    const { dto, created } = await db.$transaction((tx) =>
      sendTextMessage(tx, {
        conversationId: v.conversationId,
        senderId: user.id,
        content: v.content,
        clientMsgId: v.clientMsgId,
        replyToId: v.replyToId ?? null,
        threadRootId: v.threadRootId ?? null,
      }),
    );
    scheduleWebhooks(dto.id, created);
    return dto;
  });
}

const editSchema = z.object({
  messageId: id,
  content: z.unknown(),
});

export async function editMessageAction(input: z.input<typeof editSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(editSchema, input);
    return db.$transaction((tx) => editMessage(tx, { messageId: v.messageId, userId: user.id, content: v.content }));
  });
}

const reactionSchema = z.object({
  messageId: id,
  emoji: z.string().trim().min(1).max(16),
});

export async function toggleMessageReaction(input: z.input<typeof reactionSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(reactionSchema, input);
    return db.$transaction((tx) => toggleReaction(tx, { messageId: v.messageId, userId: user.id, emoji: v.emoji }));
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

const runConfigSchema = runConfigPatchSchema.extend({ conversationId: id });

async function requireRunConfigTarget(conversationId: string, userId: string) {
  await requireMember(db, conversationId, userId);
  if (!(await listConversationWebhookBots(db, conversationId)).length) throw new Error("该会话中没有已启用的 Webhook 机器人");
}

/** 会话级 Webhook 运行配置（基座 / 模型 / 思考强度）；仅传入的字段会被修改 */
export async function updateConversationRunConfig(input: z.input<typeof runConfigSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(runConfigSchema, input);
    await requireRunConfigTarget(v.conversationId, user.id);
    return saveConversationRunConfig(db, v.conversationId, user.id, { agent: v.agent, model: v.model, effort: v.effort });
  });
}

export async function resetConversationRunConfigAction(conversationId: string) {
  return runAction(null, async (user) => {
    const cid = parseInput(id, conversationId);
    await requireRunConfigTarget(cid, user.id);
    return resetConversationRunConfig(db, cid);
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

const sendFileSchema = z.object({
  conversationId: id,
  attachmentId: id,
  clientMsgId: z.string().min(1).max(64),
  replyToId: z.string().optional(),
  threadRootId: z.string().optional(),
});

/** 发送已上传的图片/文件附件消息 */
export async function sendFileMessage(input: z.input<typeof sendFileSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(sendFileSchema, input);
    const { dto, created } = await db.$transaction((tx) =>
      sendAttachmentMessage(tx, {
        conversationId: v.conversationId,
        senderId: user.id,
        attachmentId: v.attachmentId,
        clientMsgId: v.clientMsgId,
        replyToId: v.replyToId ?? null,
        threadRootId: v.threadRootId ?? null,
      }),
    );
    scheduleWebhooks(dto.id, created);
    return dto;
  });
}

const bizGroupSchema = z.object({
  bizType: z.enum(["project", "customer", "opportunity", "event"]),
  bizId: id,
});

/** 打开或创建业务群（项目群 / 客户群 / 商机群 / 日程会议群） */
export async function openBizGroup(input: z.input<typeof bizGroupSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(bizGroupSchema, input);
    const res = await db.$transaction((tx) =>
      getOrCreateBizGroup(tx, { id: user.id, name: user.name, permissions: user.permissions }, v.bizType, v.bizId),
    );
    if (v.bizType === "event") revalidatePath("/oa/calendar");
    if (v.bizType === "project") revalidatePath(`/pms/projects/${v.bizId}`);
    if (v.bizType === "customer") revalidatePath(`/crm/customers/${v.bizId}`);
    if (v.bizType === "opportunity") revalidatePath(`/crm/opportunities/${v.bizId}`);
    return res;
  });
}

const shareRefSchema = z.object({
  conversationId: z.string().min(1).optional(),
  targetUserId: z.string().min(1).optional(),
  refType: z.enum(["document", "approval", "customer", "opportunity", "sales", "purchase", "project", "transport", "event"]),
  refId: id,
  note: z.string().max(1000, "附言不能超过 1000 字").optional(),
});

/** 从文档/审批等业务页面直接分享到会话 */
export async function shareRefToChat(input: z.input<typeof shareRefSchema>) {
  return runAction(null, async (user) => {
    const v = parseInput(shareRefSchema, input);
    if (!v.conversationId && !v.targetUserId) throw new Error("请选择要分享的会话或成员");
    const res = await db.$transaction((tx) =>
      shareRefMessage(
        tx,
        { id: user.id, permissions: user.permissions },
        {
          conversationId: v.conversationId ?? null,
          targetUserId: v.targetUserId ?? null,
          refType: v.refType,
          refId: v.refId,
          note: v.note ?? null,
        },
      ),
    );
    scheduleWebhooks(res.dto.id, true);
    return res;
  });
}
