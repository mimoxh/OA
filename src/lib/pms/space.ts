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

export class ProjectSpaceExistsError extends Error {
  constructor() {
    super("项目已有文档空间");
  }
}

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
  // 条件更新抢占：并发创建时只有一个事务能写入 spaceId，其余抛错回滚（连同刚建的空间）
  const claimed = await tx.project.updateMany({ where: { id: project.id, spaceId: null }, data: { spaceId: space.id, documentId: null } });
  if (!claimed.count) throw new ProjectSpaceExistsError();
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

type UpgradableProject = SpaceProject & { ownerId: string; spaceId: string | null; documentId: string | null; taskTypesReady: boolean };

async function migrateLegacyDoc(project: UpgradableProject) {
  await db.$transaction(async (tx) => {
    const fresh = await tx.project.findUnique({ where: { id: project.id }, select: { spaceId: true, documentId: true } });
    if (!fresh || fresh.spaceId || !fresh.documentId) return;
    const doc = await tx.document.findUnique({ where: { id: fresh.documentId }, select: { kind: true } });
    if (!doc || doc.kind === "row") {
      // 旧文档已不存在：只清掉失效的关联，不替用户建一个空的文档空间
      await tx.project.updateMany({ where: { id: project.id, spaceId: null, documentId: fresh.documentId }, data: { documentId: null } });
      return;
    }
    await createProjectSpace(tx, project, { actorId: project.ownerId, legacyDocId: fresh.documentId });
  });
}

async function seedTaskTypes(projectId: string) {
  await db.$transaction(async (tx) => {
    // 先抢占标记，避免并发打开时重复创建
    const claimed = await tx.project.updateMany({ where: { id: projectId, taskTypesReady: false }, data: { taskTypesReady: true } });
    if (!claimed.count) return;
    const existing = new Set((await tx.taskType.findMany({ where: { projectId }, select: { name: true } })).map((t) => t.name));
    const missing = DEFAULT_TASK_TYPES.filter((t) => !existing.has(t.name));
    if (!missing.length) return;
    const base = existing.size;
    await tx.taskType.createMany({
      data: missing.map((t, i) => ({ projectId, name: t.name, color: t.color, sortOrder: base + i })),
    });
  });
}

/**
 * 打开项目时的数据升级：旧版单篇项目文档迁入项目文档空间、老项目补建默认任务类型。
 * 在页面渲染中调用，调用方须先确认用户有 pms:view（布局与页面并行渲染，布局里的权限检查拦不住页面副作用）。
 * 每一步都幂等且失败不抛出：升级失败时页面照常展示，下次打开再重试。
 */
export async function upgradeProject(project: UpgradableProject) {
  if (!project.spaceId && project.documentId) {
    try {
      await migrateLegacyDoc(project);
    } catch (e) {
      if (!(e instanceof ProjectSpaceExistsError)) console.error(`[pms] 项目 ${project.id} 旧文档迁移失败`, e);
    }
  }
  if (!project.taskTypesReady) {
    try {
      await seedTaskTypes(project.id);
    } catch (e) {
      console.error(`[pms] 项目 ${project.id} 默认任务类型补建失败`, e);
    }
  }
}
