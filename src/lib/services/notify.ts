import type { DbClient } from "@/lib/db";

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
