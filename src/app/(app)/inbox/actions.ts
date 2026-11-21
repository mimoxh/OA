"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { parseInput } from "@/lib/oa/validate";

export async function setNotificationRead(id: string, read: boolean) {
  return runAction(null, async (user) => {
    await db.notification.updateMany({
      where: { id: parseInput(z.string().min(1), id), userId: user.id },
      data: { read: !!read },
    });
    revalidatePath("/inbox");
  });
}

export async function markAllNotificationsRead(type?: string) {
  return runAction(null, async (user) => {
    const t = parseInput(z.string().max(30).optional(), type || undefined);
    const r = await db.notification.updateMany({ where: { userId: user.id, read: false, ...(t ? { type: t } : {}) }, data: { read: true } });
    revalidatePath("/inbox");
    return { count: r.count };
  });
}

export async function deleteNotification(id: string) {
  return runAction(null, async (user) => {
    await db.notification.deleteMany({ where: { id: parseInput(z.string().min(1), id), userId: user.id } });
    revalidatePath("/inbox");
  });
}

export async function clearReadNotifications() {
  return runAction(null, async (user) => {
    const r = await db.notification.deleteMany({ where: { userId: user.id, read: true } });
    revalidatePath("/inbox");
    return { count: r.count };
  });
}
