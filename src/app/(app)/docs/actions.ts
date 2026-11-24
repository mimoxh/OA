"use server";

import { unlink } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/dal";
import { notify } from "@/lib/services/notify";
import { getDocAccess, getSpaceAccess, isDocsAdmin, spaceAccess } from "@/lib/docs/access";
import { attachmentPath } from "@/lib/docs/attachments";
import { broadcastToDoc, callCollab } from "@/lib/docs/collab-client";
import { EMPTY_DOC, extractText, parseContent, type JSONNode } from "@/lib/docs/content";
import { syncDocumentLinks } from "@/lib/docs/links";
import { createDatabaseRecord } from "@/lib/docs/database/server";
import { findTemplate } from "@/lib/docs/templates";
import { collectDescendantIds, isDescendant } from "@/lib/docs/tree";
import { EMPTY_WHITEBOARD, WHITEBOARD_ICON } from "@/lib/docs/whiteboard/content";
import { getWhiteboardReferences, requireWhiteboardScene, writeWhiteboard } from "@/lib/docs/whiteboard/server";

const NEW_DOC_CONTENT = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

function revalidateDocs() {
  revalidatePath("/", "layout");
}

async function requireDocRead(user: CurrentUser, id: string) {
  const r = await getDocAccess(user, id);
  if (!r || !r.canRead) throw new Error("文档不存在或没有访问权限");
  return r;
}

async function requireDocWrite(user: CurrentUser, id: string) {
  const r = await requireDocRead(user, id);
  if (!r.canWrite) throw new Error(r.doc.deletedAt ? "文档已在回收站中，请先恢复" : "没有编辑该文档的权限");
  return r;
}

async function requireSpaceEdit(user: CurrentUser, spaceId: string) {
  const r = await getSpaceAccess(user, spaceId);
  if (!r || !r.access.canView) throw new Error("空间不存在或没有访问权限");
  if (!r.access.canEdit) throw new Error("没有在该空间中编辑的权限");
  return r;
}

async function requireSpaceManage(user: CurrentUser, spaceId: string) {
  const r = await getSpaceAccess(user, spaceId);
  if (!r || !r.access.canView) throw new Error("空间不存在或没有访问权限");
  if (!r.access.canManage) throw new Error("只有空间所有者或管理员可以管理空间");
  return r;
}

async function nextSortOrder(spaceId: string, parentId: string | null) {
  const last = await db.document.findFirst({
    where: { spaceId, parentId, deletedAt: null, isTemplate: false, kind: { not: "row" } },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

async function requirePageContainer(spaceId: string, parentId: string | null) {
  if (!parentId) return;
  const parent = await db.document.findUnique({
    where: { id: parentId },
    select: { spaceId: true, deletedAt: true, kind: true },
  });
  if (!parent || parent.spaceId !== spaceId || parent.deletedAt) throw new Error("父页面不存在");
  if (parent.kind === "database") throw new Error("请直接在多维表格中新建记录");
  if (parent.kind === "whiteboard") throw new Error("白板下不能创建子页面");
}

// ───────────── 页面 ─────────────

const createSchema = z.object({
  spaceId: z.string().min(1),
  parentId: z.string().nullish(),
  title: z.string().max(200).optional(),
  template: z.string().nullish(),
  templateDocId: z.string().nullish(),
});

export async function createDocument(input: z.input<typeof createSchema>) {
  return runAction("docs:edit", async (user) => {
    const v = createSchema.parse(input);
    await requireSpaceEdit(user, v.spaceId);
    const parentId = v.parentId ?? null;
    await requirePageContainer(v.spaceId, parentId);
    let title = v.title?.trim() ?? "";
    let icon: string | null = null;
    let content = NEW_DOC_CONTENT;
    if (v.template) {
      const t = findTemplate(v.template);
      if (!t) throw new Error("模板不存在");
      title = title || t.title();
      icon = t.icon;
      content = JSON.stringify(t.content());
    } else if (v.templateDocId) {
      const t = await requireDocRead(user, v.templateDocId);
      if (t.doc.kind === "whiteboard") throw new Error("白板不能作为页面模板");
      title = title || t.doc.title;
      icon = t.doc.icon;
      content = t.doc.content;
    }
    const parsedContent = parseContent(content);
    const doc = await db.document.create({
      data: {
        spaceId: v.spaceId,
        parentId,
        title,
        icon,
        content,
        text: extractText(parsedContent),
        sortOrder: await nextSortOrder(v.spaceId, parentId),
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await syncDocumentLinks(db, doc.id, parsedContent, { isTemplate: false });
    revalidateDocs();
    return { id: doc.id, title: doc.title };
  });
}

const createDatabaseSchema = z.object({
  spaceId: z.string().min(1),
  parentId: z.string().nullish(),
  title: z.string().max(200).optional(),
  icon: z.string().max(16).nullish(),
});

export async function createDatabase(input: z.input<typeof createDatabaseSchema>) {
  return runAction("docs:edit", async (user) => {
    const v = createDatabaseSchema.parse(input);
    const created = await createDatabaseRecord(user, v);
    revalidateDocs();
    return created;
  });
}

const createWhiteboardSchema = createSchema.pick({ spaceId: true, parentId: true, title: true });

export async function createWhiteboard(input: z.input<typeof createWhiteboardSchema>) {
  return runAction("docs:edit", async (user) => {
    const { spaceId, parentId = null, title } = createWhiteboardSchema.parse(input);
    await requireSpaceEdit(user, spaceId);
    await requirePageContainer(spaceId, parentId);
    const created = await db.document.create({
      data: {
        kind: "whiteboard",
        spaceId,
        parentId,
        title: title?.trim() || "未命名白板",
        icon: WHITEBOARD_ICON,
        content: EMPTY_WHITEBOARD,
        sortOrder: await nextSortOrder(spaceId, parentId),
        createdById: user.id,
        updatedById: user.id,
      },
      select: { id: true, title: true },
    });
    revalidateDocs();
    return created;
  });
}

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200).optional(),
  icon: z.string().max(16).nullable().optional(),
  cover: z.string().max(500).nullable().optional(),
  fullWidth: z.boolean().optional(),
  /** 文档页标题输入时为 true：客户端自己通过协同通道广播，避免延迟的广播覆盖正在输入的内容 */
  silent: z.boolean().optional(),
});

export async function updateDocument(input: z.input<typeof updateSchema>) {
  return runAction("docs:edit", async (user) => {
    const v = updateSchema.parse(input);
    const { doc } = await requireDocWrite(user, v.id);
    const data: { title?: string; icon?: string | null; cover?: string | null; fullWidth?: boolean } = {};
    if (v.title !== undefined) data.title = v.title.trim();
    if (v.icon !== undefined) data.icon = v.icon || null;
    if (v.cover !== undefined) data.cover = v.cover || null;
    if (v.fullWidth !== undefined) data.fullWidth = v.fullWidth;
    await db.document.update({ where: { id: v.id }, data: { ...data, updatedById: user.id } });
    if (!v.silent && doc.kind !== "whiteboard") await broadcastToDoc(user.id, v.id, { type: "meta", ...data });
    revalidateDocs();
    return null;
  });
}

export async function toggleFavorite(id: string) {
  return runAction("docs:view", async (user) => {
    await requireDocRead(user, id);
    const existing = await db.documentFavorite.findUnique({ where: { userId_documentId: { userId: user.id, documentId: id } } });
    if (existing) await db.documentFavorite.delete({ where: { id: existing.id } });
    else await db.documentFavorite.create({ data: { userId: user.id, documentId: id } });
    revalidateDocs();
    return { favorite: !existing };
  });
}

const moveSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().nullish(),
  spaceId: z.string().min(1),
  position: z.enum(["before", "after", "inside", "end"]),
});

export async function moveDocument(input: z.input<typeof moveSchema>) {
  return runAction("docs:edit", async (user) => {
    const v = moveSchema.parse(input);
    const { doc } = await requireDocWrite(user, v.id);
    if (doc.kind === "row") throw new Error("多维表格的记录行不支持在目录树中移动");
    let spaceId = v.spaceId;
    let parentId: string | null = null;
    let target: { id: string; parentId: string | null; spaceId: string; kind: string } | null = null;
    if (v.position !== "end") {
      if (!v.targetId) throw new Error("缺少目标页面");
      if (v.targetId === v.id) return null;
      target = await db.document.findUnique({ where: { id: v.targetId }, select: { id: true, parentId: true, spaceId: true, kind: true } });
      if (!target) throw new Error("目标页面不存在");
      if (v.position === "inside" && target.kind === "database") {
        throw new Error("不能将页面移入多维表格中");
      }
      if (v.position === "inside" && target.kind === "whiteboard") throw new Error("不能将页面移入白板");
      spaceId = target.spaceId;
      parentId = v.position === "inside" ? target.id : target.parentId;
    }
    if (parentId && (await isDescendant(db, v.id, parentId))) throw new Error("不能移动到自己的子页面下");
    if (spaceId !== doc.spaceId) await requireSpaceEdit(user, spaceId);

    const siblings = await db.document.findMany({
      where: { spaceId, parentId, deletedAt: null, isTemplate: false, kind: { not: "row" }, id: { not: v.id } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const ids = siblings.map((s) => s.id);
    let index = ids.length;
    if (target && (v.position === "before" || v.position === "after")) {
      const i = ids.indexOf(target.id);
      index = i < 0 ? ids.length : v.position === "before" ? i : i + 1;
    }
    ids.splice(index, 0, v.id);

    await db.$transaction(async (tx) => {
      await tx.document.update({ where: { id: v.id }, data: { parentId, spaceId } });
      for (const [i, id] of ids.entries()) await tx.document.update({ where: { id }, data: { sortOrder: i } });
      if (spaceId !== doc.spaceId) {
        const desc = await collectDescendantIds(tx, v.id);
        if (desc.length) await tx.document.updateMany({ where: { id: { in: desc } }, data: { spaceId } });
        await tx.documentAttachment.updateMany({ where: { documentId: { in: [v.id, ...desc] } }, data: { spaceId } });
      }
    });
    revalidateDocs();
    return null;
  });
}

export async function trashDocument(id: string) {
  return runAction("docs:edit", async (user) => {
    await requireDocWrite(user, id);
    const desc = await collectDescendantIds(db, id, { deletedAt: null });
    const now = new Date();
    await db.document.updateMany({ where: { id: { in: [id, ...desc] }, deletedAt: null }, data: { deletedAt: now } });
    await broadcastToDoc(user.id, id, { type: "trashed" });
    revalidateDocs();
    return { count: desc.length + 1 };
  });
}

export async function restoreDocument(id: string) {
  return runAction("docs:edit", async (user) => {
    const r = await requireDocRead(user, id);
    if (!r.access.canEdit) throw new Error("没有在该空间中编辑的权限");
    const doc = r.doc;
    if (!doc.deletedAt) return null;
    const desc = await collectDescendantIds(db, id, { deletedAt: { not: null } });
    const sameBatch = desc.length
      ? await db.document.findMany({ where: { id: { in: desc }, deletedAt: doc.deletedAt }, select: { id: true } })
      : [];
    let parentId = doc.parentId;
    if (parentId) {
      const parent = await db.document.findUnique({ where: { id: parentId }, select: { deletedAt: true, kind: true } });
      if (doc.kind === "row") {
        if (!parent || parent.deletedAt) throw new Error("所属多维表格仍在回收站中，请先恢复多维表格");
      } else if (!parent || parent.deletedAt) {
        parentId = null;
      }
    }
    await db.$transaction(async (tx) => {
      await tx.document.update({
        where: { id },
        data: { deletedAt: null, parentId, ...(parentId !== doc.parentId ? { sortOrder: await nextSortOrder(doc.spaceId, null) } : {}) },
      });
      if (sameBatch.length) await tx.document.updateMany({ where: { id: { in: sameBatch.map((d) => d.id) } }, data: { deletedAt: null } });
    });
    await broadcastToDoc(user.id, id, { type: "trashed" });
    revalidateDocs();
    return null;
  });
}

async function purge(ids: string[]) {
  await db.$transaction(async (tx) => {
    await tx.comment.deleteMany({ where: { targetType: "document", targetId: { in: ids } } });
    await tx.document.updateMany({ where: { parentId: { in: ids } }, data: { parentId: null } });
    await tx.document.deleteMany({ where: { id: { in: ids } } });
  });
}

export async function deleteDocumentForever(id: string) {
  return runAction("docs:edit", async (user) => {
    const r = await requireDocRead(user, id);
    if (!r.access.canEdit) throw new Error("没有在该空间中编辑的权限");
    if (!r.doc.deletedAt) throw new Error("请先将页面移到回收站");
    const desc = await collectDescendantIds(db, id);
    await purge([id, ...desc]);
    revalidateDocs();
    return null;
  });
}

export async function emptyTrash() {
  return runAction("docs:edit", async (user) => {
    const rows = await db.document.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, space: { include: { members: { select: { userId: true, role: true } } } } },
    });
    const ids = rows.filter((r) => spaceAccess(r.space, user).canEdit).map((r) => r.id);
    const all = new Set(ids);
    for (const id of ids) (await collectDescendantIds(db, id)).forEach((d) => all.add(d));
    if (all.size) await purge([...all]);
    revalidateDocs();
    return { count: all.size };
  });
}

export async function duplicateDocument(id: string) {
  return runAction("docs:edit", async (user) => {
    const { doc } = await requireDocRead(user, id);
    if (doc.kind !== "page") throw new Error("多维表格和记录行请使用表格内复制功能");
    await requireSpaceEdit(user, doc.spaceId);
    const copy = await db.$transaction(async (tx) => {
      const siblings = await tx.document.findMany({
        where: { spaceId: doc.spaceId, parentId: doc.parentId, deletedAt: null, isTemplate: false, sortOrder: { gt: doc.sortOrder } },
        select: { id: true, sortOrder: true },
      });
      for (const s of siblings) await tx.document.update({ where: { id: s.id }, data: { sortOrder: s.sortOrder + 1 } });
      const created = await tx.document.create({
        data: {
          spaceId: doc.spaceId,
          parentId: doc.parentId,
          title: `${doc.title || "无标题"}（副本）`,
          icon: doc.icon,
          cover: doc.cover,
          fullWidth: doc.fullWidth,
          content: doc.content,
          text: doc.text,
          sortOrder: doc.sortOrder + 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await syncDocumentLinks(tx, created.id, parseContent(doc.content), { isTemplate: false });
      return created;
    });
    revalidateDocs();
    return { id: copy.id };
  });
}

export async function saveAsTemplate(id: string) {
  return runAction("docs:edit", async (user) => {
    const { doc } = await requireDocRead(user, id);
    if (doc.kind === "whiteboard") throw new Error("白板不能作为页面模板");
    await requireSpaceEdit(user, doc.spaceId);
    await db.document.create({
      data: {
        spaceId: doc.spaceId,
        title: doc.title || "无标题模板",
        icon: doc.icon,
        content: doc.content,
        text: doc.text,
        isTemplate: true,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    revalidateDocs();
    return null;
  });
}

export async function deleteTemplate(id: string) {
  return runAction("docs:edit", async (user) => {
    const { doc } = await requireDocRead(user, id);
    if (!doc.isTemplate) throw new Error("该页面不是模板");
    if (doc.createdById !== user.id && !isDocsAdmin(user)) throw new Error("只能删除自己创建的模板");
    await purge([id]);
    revalidateDocs();
    return null;
  });
}

// ───────────── 空间 ─────────────

const spaceSchema = z.object({
  name: z.string().trim().min(1, "请填写空间名称").max(40),
  icon: z.string().min(1).max(16).default("📁"),
  description: z.string().max(200).nullish(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
});

export async function createSpace(input: z.input<typeof spaceSchema>) {
  return runAction("docs:edit", async (user) => {
    const v = spaceSchema.parse(input);
    const last = await db.space.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const space = await db.space.create({
      data: {
        name: v.name,
        icon: v.icon,
        description: v.description || null,
        visibility: v.visibility,
        createdById: user.id,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    revalidateDocs();
    return { id: space.id };
  });
}

export async function updateSpace(input: z.input<typeof spaceSchema> & { id: string }) {
  return runAction("docs:edit", async (user) => {
    const v = spaceSchema.parse(input);
    const { space } = await requireSpaceManage(user, input.id);
    if (space.ownerId && v.visibility !== "PRIVATE") throw new Error("个人空间仅自己可见，不能设为公开");
    await db.space.update({
      where: { id: input.id },
      data: { name: v.name, icon: v.icon, description: v.description || null, visibility: v.visibility },
    });
    revalidateDocs();
    return null;
  });
}

export async function deleteSpace(id: string) {
  return runAction("docs:edit", async (user) => {
    const { space } = await requireSpaceManage(user, id);
    if (space.ownerId) throw new Error("个人空间不能删除");
    const [docs, atts] = await Promise.all([
      db.document.findMany({ where: { spaceId: id }, select: { id: true } }),
      db.documentAttachment.findMany({ where: { spaceId: id }, select: { id: true } }),
    ]);
    await db.$transaction(async (tx) => {
      if (docs.length) {
        const ids = docs.map((d) => d.id);
        await tx.comment.deleteMany({ where: { targetType: "document", targetId: { in: ids } } });
        await tx.document.updateMany({ where: { spaceId: id }, data: { parentId: null } });
      }
      await tx.space.delete({ where: { id } });
    });
    await Promise.all(atts.map((a) => unlink(attachmentPath(a.id)).catch(() => {})));
    revalidateDocs();
    return null;
  });
}

async function assertNotProjectSpace(spaceId: string) {
  const p = await db.project.findUnique({ where: { spaceId }, select: { name: true } });
  if (p) throw new Error(`这是项目「${p.name}」的文档空间，成员与项目成员同步，请在项目的成员页调整`);
}

const memberSchema = z.object({
  spaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "editor", "viewer"]),
});

export async function upsertSpaceMember(input: z.input<typeof memberSchema>) {
  return runAction("docs:edit", async (user) => {
    const v = memberSchema.parse(input);
    const { space } = await requireSpaceManage(user, v.spaceId);
    if (space.ownerId) throw new Error("个人空间仅自己可见，不能添加成员");
    await assertNotProjectSpace(space.id);
    const current = space.members.find((m) => m.userId === v.userId);
    if (current?.role === "owner" && v.role !== "owner" && space.members.filter((m) => m.role === "owner").length <= 1) {
      throw new Error("空间至少需要保留一位所有者");
    }
    await db.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: v.spaceId, userId: v.userId } },
      create: { spaceId: v.spaceId, userId: v.userId, role: v.role },
      update: { role: v.role },
    });
    if (!current) {
      await notify(db, {
        userIds: [v.userId],
        actorId: user.id,
        type: "system",
        title: `${user.name} 将你加入了文档空间「${space.name}」`,
        link: `/docs?space=${space.id}`,
      });
    }
    revalidateDocs();
    return null;
  });
}

export async function removeSpaceMember(input: { spaceId: string; userId: string }) {
  return runAction("docs:edit", async (user) => {
    const { space } = await requireSpaceManage(user, input.spaceId);
    if (space.ownerId) throw new Error("个人空间的成员不能调整");
    await assertNotProjectSpace(space.id);
    const current = space.members.find((m) => m.userId === input.userId);
    if (!current) return null;
    if (current.role === "owner" && space.members.filter((m) => m.role === "owner").length <= 1) {
      throw new Error("空间至少需要保留一位所有者");
    }
    await db.spaceMember.delete({ where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } } });
    revalidateDocs();
    return null;
  });
}

// ───────────── 评论 ─────────────

const commentSchema = z.object({
  documentId: z.string().min(1),
  content: z.string().trim().min(1, "评论内容不能为空").max(4000),
  quote: z.string().max(500).nullish(),
  parentId: z.string().nullish(),
  mentionIds: z.array(z.string()).max(20).default([]),
});

export async function addComment(input: z.input<typeof commentSchema>) {
  return runAction("docs:view", async (user) => {
    const v = commentSchema.parse(input);
    const { doc } = await requireDocRead(user, v.documentId);
    let root: { id: string; authorId: string } | null = null;
    if (v.parentId) {
      const parent = await db.comment.findUnique({ where: { id: v.parentId } });
      if (!parent || parent.targetType !== "document" || parent.targetId !== doc.id) throw new Error("评论不存在");
      root = parent.parentId ? await db.comment.findUnique({ where: { id: parent.parentId }, select: { id: true, authorId: true } }) : parent;
    }
    const title = doc.title || "无标题";
    const comment = await db.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: {
          targetType: "document",
          targetId: doc.id,
          authorId: user.id,
          content: v.content,
          quote: root ? null : v.quote || null,
          parentId: root?.id ?? null,
        },
      });
      const threadId = root?.id ?? c.id;
      const link = `/docs/${doc.id}?comment=${threadId}`;
      const participants = root
        ? [root.authorId, ...(await tx.comment.findMany({ where: { parentId: root.id }, select: { authorId: true } })).map((r) => r.authorId)]
        : [];
      const mentioned = [...new Set(v.mentionIds)];
      await notify(tx, {
        userIds: [doc.createdById, ...participants].filter((id) => !mentioned.includes(id)),
        actorId: user.id,
        type: "comment",
        title: root ? `${user.name} 回复了「${title}」中的评论` : `${user.name} 评论了「${title}」`,
        body: v.content.slice(0, 200),
        link,
      });
      if (mentioned.length) {
        await notify(tx, {
          userIds: mentioned,
          actorId: user.id,
          type: "mention",
          title: `${user.name} 在「${title}」的评论中提到了你`,
          body: v.content.slice(0, 200),
          link,
        });
      }
      return c;
    });
    revalidatePath(`/docs/${doc.id}`);
    return { id: comment.id };
  });
}

async function loadComment(user: CurrentUser, id: string) {
  const c = await db.comment.findUnique({ where: { id } });
  if (!c || c.targetType !== "document") throw new Error("评论不存在");
  const r = await requireDocRead(user, c.targetId);
  return { comment: c, ...r };
}

export async function setCommentResolved(input: { id: string; resolved: boolean }) {
  return runAction("docs:view", async (user) => {
    const { comment, access } = await loadComment(user, input.id);
    if (comment.authorId !== user.id && !access.canEdit) throw new Error("没有权限");
    await db.comment.update({ where: { id: comment.id }, data: { resolved: !!input.resolved } });
    revalidatePath(`/docs/${comment.targetId}`);
    return null;
  });
}

export async function deleteComment(id: string) {
  return runAction("docs:view", async (user) => {
    const { comment } = await loadComment(user, id);
    if (comment.authorId !== user.id && !isDocsAdmin(user)) throw new Error("只能删除自己的评论");
    await db.comment.delete({ where: { id } });
    revalidatePath(`/docs/${comment.targetId}`);
    return null;
  });
}

/** 正文中 @ 提及成员时调用 */
export async function notifyDocMention(input: { documentId: string; userIds: string[] }) {
  return runAction("docs:edit", async (user) => {
    const { doc } = await requireDocWrite(user, input.documentId);
    const ids = z.array(z.string()).max(20).parse(input.userIds);
    await notify(db, {
      userIds: ids,
      actorId: user.id,
      type: "mention",
      title: `${user.name} 在「${doc.title || "无标题"}」中提到了你`,
      body: doc.text.slice(0, 120) || null,
      link: `/docs/${doc.id}`,
    });
    return null;
  });
}

// ───────────── 历史版本 ─────────────

export async function listVersions(documentId: string) {
  return runAction("docs:view", async (user) => {
    await requireDocRead(user, documentId);
    const rows = await db.documentVersion.findMany({
      where: { documentId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, title: true, createdAt: true, createdBy: { select: { name: true, avatarColor: true } } },
    });
    return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt.toISOString(), author: r.createdBy }));
  });
}

export async function getVersion(id: string) {
  return runAction("docs:view", async (user) => {
    const v = await db.documentVersion.findUnique({ where: { id } });
    if (!v) throw new Error("版本不存在");
    const { doc } = await requireDocRead(user, v.documentId);
    if (doc.kind === "whiteboard") {
      const scene = requireWhiteboardScene(v.content);
      const references = await getWhiteboardReferences(user, scene.elements);
      return { id: v.id, title: v.title, content: v.content, references };
    }
    return { id: v.id, title: v.title, content: v.content };
  });
}

const saveVersionSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().max(200).optional(),
  content: z.string().max(5_000_000).optional(),
});

export async function saveVersion(input: z.input<typeof saveVersionSchema>) {
  return runAction("docs:edit", async (user) => {
    const v = saveVersionSchema.parse(input);
    const { doc } = await requireDocWrite(user, v.documentId);
    if (doc.kind === "whiteboard") {
      requireWhiteboardScene(doc.content);
      await db.documentVersion.create({
        data: { documentId: doc.id, title: doc.title, content: doc.content, createdById: user.id },
      });
      return null;
    }
    if (v.title === undefined || v.content === undefined) throw new Error("缺少文档内容");
    const json: JSONNode = parseContent(v.content);
    if (json === EMPTY_DOC && v.content !== JSON.stringify(EMPTY_DOC)) throw new Error("文档内容无效");
    await db.documentVersion.create({
      data: { documentId: v.documentId, title: v.title, content: JSON.stringify(json), createdById: user.id },
    });
    return null;
  });
}

export async function restoreVersion(versionId: string) {
  return runAction("docs:edit", async (user) => {
    const v = await db.documentVersion.findUnique({ where: { id: versionId } });
    if (!v) throw new Error("版本不存在");
    const { doc } = await requireDocWrite(user, v.documentId);
    if (doc.kind === "whiteboard") {
      const current = requireWhiteboardScene(doc.content);
      const previous = requireWhiteboardScene(v.content);
      await writeWhiteboard(user, doc, current.revision, previous.elements, v.title);
    } else {
      await callCollab("/restore", user.id, { documentId: v.documentId, versionId });
    }
    revalidateDocs();
    return null;
  });
}
