import type { DbClient } from "@/lib/db";
import { queueEvent } from "@/lib/realtime/buffer";
import { toMessageDTO } from "./queries";
import type { Card } from "./types";

type CardStatus = NonNullable<Card["status"]>;

/**
 * 审批卡片：标题等基础信息由 base 提供；状态与操作按钮按「卡片接收者」计算。
 */
export async function buildApprovalCard(
  client: DbClient,
  instanceId: string,
  ownerUserId: string,
  base: { title: string; body?: string | null; link?: string | null },
): Promise<Card> {
  const instance = await client.approvalInstance.findUnique({
    where: { id: instanceId },
    include: {
      flow: { select: { name: true } },
      applicant: { select: { id: true, name: true, avatarColor: true } },
      tasks: { where: { status: "PENDING" }, select: { stepName: true, approverId: true } },
    },
  });
  if (!instance) throw new Error("审批单不存在");

  let status: CardStatus;
  if (instance.status === "PENDING") {
    const steps = [...new Set(instance.tasks.map((t) => t.stepName))].join("、");
    status = { label: steps ? `审批中 · ${steps}` : "审批中", color: "blue" };
  } else if (instance.status === "APPROVED") {
    status = { label: "已通过", color: "green" };
  } else if (instance.status === "REJECTED") {
    status = { label: "已驳回", color: "red" };
  } else {
    status = { label: "已撤回", color: "gray" };
  }

  const canAct = instance.tasks.some((t) => t.approverId === ownerUserId);
  return {
    template: "approval",
    title: base.title,
    body: base.body ?? null,
    link: base.link ?? null,
    actor: instance.applicant ? { id: instance.applicant.id, name: instance.applicant.name, avatarColor: instance.applicant.avatarColor } : null,
    ref: { type: "approval", id: instanceId },
    fields: [
      { label: "审批类型", value: instance.flow.name },
      { label: "申请人", value: instance.applicant.name },
      { label: "单号", value: instance.no },
    ],
    status,
    actions: canAct
      ? [
          { key: "approve", label: "同意" },
          { key: "reject", label: "驳回" },
        ]
      : undefined,
  };
}

/**
 * 审批状态变化后刷新所有引用该审批单的 CARD 消息（各机器人会话按其唯一成员重算操作按钮）。
 * 在事务末尾调用；事件经队列在提交后下发。
 */
export async function refreshApprovalCards(client: DbClient, instanceId: string) {
  const messages = await client.message.findMany({
    where: { type: "CARD", refType: "approval", refId: instanceId },
    include: {
      sender: { select: { id: true, name: true, avatarColor: true } },
      conversation: { include: { members: { select: { userId: true } } } },
    },
  });
  for (const msg of messages) {
    const ownerId = msg.conversation.members[0]?.userId;
    if (!ownerId) continue;
    let old: Card;
    try {
      old = JSON.parse(msg.content) as Card;
    } catch {
      continue;
    }
    try {
      const next = await buildApprovalCard(client, instanceId, ownerId, {
        title: old.title,
        body: old.body,
        link: old.link,
      });
      if (JSON.stringify(next) === JSON.stringify(old)) continue;
      const updated = await client.message.update({
        where: { id: msg.id },
        data: { content: JSON.stringify(next) },
        include: { sender: { select: { id: true, name: true, avatarColor: true } } },
      });
      const dto = await toMessageDTO(client, updated);
      queueEvent(
        msg.conversation.members.map((m) => m.userId),
        { type: "message.updated", conversationId: msg.conversationId, message: dto },
      );
    } catch (e) {
      console.error("[im] 刷新审批卡片失败", e);
    }
  }
}
