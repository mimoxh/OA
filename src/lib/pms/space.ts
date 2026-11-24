import "server-only";
import { db, type Tx } from "@/lib/db";
import { collectDescendantIds } from "@/lib/docs/tree";
import { DEFAULT_TASK_TYPES } from "./utils";

/** 项目角色 → 项目文档空间角色 */
const SPACE_ROLE_OF: Record<string, string> = { owner: "owner", member: "editor", viewer: "viewer" };

export function projectSpaceRole(role: string) {
  return SPACE_ROLE_OF[role] ?? "editor";
}

function overviewDoc(name: string, description: string | null) {
  const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
  const h = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
  const blocks = [h("项目背景"), p(description ?? ""), h("目标与范围"), p(""), h("会议纪要"), p("")];
  const text = [name, "项目概述", "项目背景", description ?? "", "目标与范围", "会议纪要"].filter(Boolean).join(" ");
  return { content: JSON.stringify({ type: "doc", content: blocks }), text };
}

/** 把一篇文档（连同子页面、附件）整体移到另一个空间的根目录 */
async function moveDocTree(tx: Tx, docId: string, spaceId: string) {
  const doc = await tx.document.findUnique({ where: { id: docId }, select: { id: true, kind: true } });
  if (!doc || doc.kind === "row") return false;
  const desc = await collectDescendantIds(tx, doc.id);
  await tx.document.update({ where: { id: doc.id }, data: { spaceId, parentId: null, sortOrder: 0 } });
  if (desc.length) await tx.document.updateMany({ where: { id: { in: desc } }, data: { spaceId } });
  await tx.documentAttachment.updateMany({ where: { documentId: { in: [doc.id, ...desc] } }, data: { spaceId } });
  return true;
}

type SpaceProject = { id: string; name: string; icon: string; description: string | null };

/**
 * 为项目创建私有文档空间，项目成员按角色同步为空间成员。
 * legacyDocId：旧版的单篇项目文档，存在时整体迁入新空间；否则可选新建一篇「项目概述」。
 */
export async function createProjectSpace(
  tx: Tx,
  project: SpaceProject,
  opts: { actorId: string; legacyDocId?: string | null; createOverview?: boolean },
) {
  const members = await tx.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true, role: true } });
  const last = await tx.space.aggregate({ where: { ownerId: null }, _max: { sortOrder: true } });
  const space = await tx.space.create({
    data: {
      name: project.name,
      icon: project.icon,
      description: `项目「${project.name}」的文档空间，成员与项目成员同步`,
      visibility: "PRIVATE",
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      createdById: opts.actorId,
      members: { create: members.map((m) => ({ userId: m.userId, role: projectSpaceRole(m.role) })) },
    },
    select: { id: true },
  });
  await tx.project.update({ where: { id: project.id }, data: { spaceId: space.id, documentId: null } });
  const moved = opts.legacyDocId ? await moveDocTree(tx, opts.legacyDocId, space.id) : false;
  if (!moved && opts.createOverview) {
    const { content, text } = overviewDoc(project.name, project.description);
    await tx.document.create({
      data: { spaceId: space.id, title: "项目概述", icon: project.icon, content, text, createdById: opts.actorId, updatedById: opts.actorId },
    });
  }
  return space.id;
}

/** 项目成员变动后同步到项目文档空间；role 为 null 表示移除 */
export async function syncProjectSpaceMember(tx: Tx, projectId: string, userId: string, role: string | null) {
  const p = await tx.project.findUnique({ where: { id: projectId }, select: { spaceId: true } });
  if (!p?.spaceId) return;
  if (role === null) {
    await tx.spaceMember.deleteMany({ where: { spaceId: p.spaceId, userId } });
    return;
  }
  const r = projectSpaceRole(role);
  await tx.spaceMember.upsert({
    where: { spaceId_userId: { spaceId: p.spaceId, userId } },
    create: { spaceId: p.spaceId, userId, role: r },
    update: { role: r },
  });
}

/** 打开项目时的数据升级：旧版单篇项目文档迁入项目文档空间、老项目补建默认任务类型 */
export async function upgradeProject(project: SpaceProject & { ownerId: string; spaceId: string | null; documentId: string | null; taskTypesReady: boolean }) {
  if (!project.spaceId && project.documentId) {
    await db.$transaction(async (tx) => {
      const fresh = await tx.project.findUnique({ where: { id: project.id }, select: { spaceId: true, documentId: true } });
      if (!fresh || fresh.spaceId || !fresh.documentId) return;
      await createProjectSpace(tx, project, { actorId: project.ownerId, legacyDocId: fresh.documentId });
    });
  }
  if (!project.taskTypesReady) {
    await db.$transaction(async (tx) => {
      // 先抢占标记，避免并发打开时重复创建
      const claimed = await tx.project.updateMany({ where: { id: project.id, taskTypesReady: false }, data: { taskTypesReady: true } });
      if (!claimed.count) return;
      await tx.taskType.createMany({
        data: DEFAULT_TASK_TYPES.map((t, i) => ({ projectId: project.id, name: t.name, color: t.color, sortOrder: i })),
      });
    });
  }
}
