"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { getDocAccess } from "@/lib/docs/access";

const idSchema = z.string().min(1).max(64);

/** 打开文档时加入左侧栏「最近打开」；已在列表中则保持原位置 */
export async function openRecentDoc(id: string) {
  return runAction("docs:view", async (user) => {
    const documentId = idSchema.parse(id);
    const r = await getDocAccess(user, documentId);
    if (!r || !r.canRead || r.doc.deletedAt || r.doc.isTemplate) return null;
    await db.documentRecent.upsert({
      where: { userId_documentId: { userId: user.id, documentId } },
      create: { userId: user.id, documentId },
      update: {},
    });
    return null;
  });
}

/** 用户在左侧栏手动关闭最近打开的文档 */
export async function closeRecentDoc(id: string) {
  return runAction(null, async (user) => {
    const documentId = idSchema.parse(id);
    await db.documentRecent.deleteMany({ where: { userId: user.id, documentId } });
    return null;
  });
}
