import "server-only";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/dal";

/** 项目级管理（项目属性、成员、里程碑）：pms:edit 或项目负责人 */
export async function canManageProject(user: CurrentUser, projectId: string) {
  if (can(user, "pms:edit")) return true;
  const p = await db.project.findUnique({ where: { id: projectId }, select: { ownerId: true } });
  if (p?.ownerId === user.id) return true;
  const m = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  return m?.role === "owner";
}

/** 任务级编辑：pms:edit、项目负责人或项目成员（viewer 除外） */
export async function canEditProjectTasks(user: CurrentUser, projectId: string) {
  if (await canManageProject(user, projectId)) return true;
  const m = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  return !!m && m.role !== "viewer";
}

export async function assertManageProject(user: CurrentUser, projectId: string) {
  if (!(await canManageProject(user, projectId))) throw new Error("只有项目负责人或项目管理员可以执行该操作");
}

export async function assertEditTasks(user: CurrentUser, projectId: string) {
  if (!(await canEditProjectTasks(user, projectId))) throw new Error("只有项目成员可以编辑该项目的任务");
}
