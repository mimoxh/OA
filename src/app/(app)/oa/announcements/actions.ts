"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { audit, notify } from "@/lib/services/notify";
import { parseInput } from "@/lib/oa/validate";

const schema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "请填写公告标题").max(100, "标题不能超过 100 字"),
  content: z.string().trim().min(1, "请填写公告内容").max(20000, "内容过长"),
  category: z.string().trim().min(1, "请选择分类").max(20, "分类不能超过 20 字"),
  pinned: z.boolean(),
  notifyAll: z.boolean(),
});

export type AnnouncementInput = z.input<typeof schema>;

export async function saveAnnouncement(input: AnnouncementInput) {
  return runAction("oa:edit", async (user) => {
    const v = parseInput(schema, input);
    const id = await db.$transaction(async (tx) => {
      const data = { title: v.title, content: v.content, category: v.category, pinned: v.pinned };
      const isNew = !v.id;
      const a = v.id
        ? await tx.announcement.update({ where: { id: v.id }, data })
        : await tx.announcement.create({ data: { ...data, authorId: user.id, reads: { create: { userId: user.id } } } });
      if (v.notifyAll) {
        const users = await tx.user.findMany({ where: { active: true, isBot: false }, select: { id: true } });
        await notify(tx, {
          userIds: users.map((u) => u.id),
          actorId: user.id,
          type: "announcement",
          title: isNew ? `${user.name} 发布了公告「${a.title}」` : `公告「${a.title}」已更新`,
          body: v.content.replace(/[#>*`\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 100),
          link: `/oa/announcements/${a.id}`,
        });
      }
      await audit(tx, { entityType: "announcement", entityId: a.id, action: isNew ? "create" : "update", userId: user.id });
      return a.id;
    });
    revalidatePath("/oa/announcements");
    revalidatePath(`/oa/announcements/${id}`);
    return { id };
  });
}

export async function setAnnouncementPinned(id: string, pinned: boolean) {
  return runAction("oa:edit", async () => {
    await db.announcement.update({ where: { id: parseInput(z.string().min(1), id) }, data: { pinned: !!pinned } });
    revalidatePath("/oa/announcements");
  });
}

export async function deleteAnnouncement(id: string) {
  return runAction("oa:edit", async (user) => {
    const a = await db.announcement.findUnique({ where: { id: parseInput(z.string().min(1), id) } });
    if (!a) throw new Error("公告不存在");
    await db.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id: a.id } });
      await tx.notification.deleteMany({ where: { type: "announcement", link: `/oa/announcements/${a.id}` } });
      await audit(tx, { entityType: "announcement", entityId: a.id, action: "delete", detail: a.title, userId: user.id });
    });
    revalidatePath("/oa/announcements");
  });
}
