import type { DbClient } from "@/lib/db";
import { botForNotifyType } from "@/lib/im/bots";
import { buildApprovalCard } from "@/lib/im/cards";
import { appendMessage, getOrCreateBotConversation } from "@/lib/im/service";
import type { Card } from "@/lib/im/types";
import { queueEvent } from "@/lib/realtime/buffer";

export type NotifyInput = {
  userIds: (string | null | undefined)[];
  actorId?: string | null;
  type: "mention" | "comment" | "approval" | "task" | "system" | "announcement" | "order" | "event";
  title: string;
  body?: string | null;
  link?: string | null;
  /** 默认不通知操作人自己 */
  includeActor?: boolean;
};

export async function notify(tx: DbClient, input: NotifyInput) {
  const ids = [...new Set(input.userIds.filter((x): x is string => !!x))].filter(
    (id) => input.includeActor || id !== input.actorId,
  );
  if (!ids.length) return;
  await tx.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  });

  // IM：收件人生成实时事件，并向对应机器人会话投递卡片
  queueEvent(ids, { type: "notification.new" });
  const botKey = botForNotifyType(input.type);
  let actor: Card["actor"] = null;
  if (input.actorId) {
    actor =
      (await tx.user.findUnique({
        where: { id: input.actorId },
        select: { id: true, name: true, avatarColor: true },
      })) ?? null;
  }
  // 审批类通知且链接指向审批单 → 审批卡片（含状态与操作按钮）；否则通用卡片
  const approvalMatch = input.link?.match(/^\/oa\/approvals\/([^/?#]+)/);
  for (const userId of ids) {
    const conv = await getOrCreateBotConversation(tx, userId, botKey);
    let card: Card;
    if (input.type === "approval" && approvalMatch) {
      try {
        card = await buildApprovalCard(tx, approvalMatch[1], userId, {
          title: input.title,
          body: input.body,
          link: input.link,
        });
      } catch {
        card = { template: "generic", title: input.title, body: input.body ?? null, link: input.link ?? null, actor };
      }
    } else {
      card = { template: "generic", title: input.title, body: input.body ?? null, link: input.link ?? null, actor };
    }
    await appendMessage(tx, {
      conversationId: conv.id,
      senderId: null,
      type: "CARD",
      content: card,
      text: input.title,
      refType: card.ref?.type ?? null,
      refId: card.ref?.id ?? null,
    });
  }
}

export async function audit(
  tx: DbClient,
  input: { entityType: string; entityId: string; action: string; detail?: string; userId?: string | null },
) {
  await tx.auditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      detail: input.detail ?? null,
      userId: input.userId ?? null,
    },
  });
}
