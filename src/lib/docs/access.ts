import type { Prisma } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";
import { hasPermission, parsePermissions } from "@/lib/permissions";
import { getDisabledApps } from "@/lib/apps-store";

/** 文档权限判断所需的最小用户信息（Next 页面与协同服务共用，因此不依赖 next/*） */
export type DocUser = { id: string; permissions: string[] };

export type SpaceLike = {
  visibility: "PUBLIC" | "PRIVATE";
  createdById: string;
  /** 个人空间的主人；非空时只有本人可以访问 */
  ownerId: string | null;
  members: { userId: string; role: string }[];
};

export type SpaceAccess = { canView: boolean; canEdit: boolean; canManage: boolean; role: string | null };

export function isDocsAdmin(user: DocUser) {
  return user.permissions.includes("admin");
}

export function spaceAccess(space: SpaceLike, user: DocUser): SpaceAccess {
  if (space.ownerId) {
    const own = space.ownerId === user.id && hasPermission(user.permissions, "docs:view");
    const canEdit = own && hasPermission(user.permissions, "docs:edit");
    return { canView: own, canEdit, canManage: canEdit, role: own ? "owner" : null };
  }
  const member = space.members.find((m) => m.userId === user.id) ?? null;
  const role = member?.role ?? null;
  if (isDocsAdmin(user)) return { canView: true, canEdit: true, canManage: true, role };
  if (!hasPermission(user.permissions, "docs:view")) return { canView: false, canEdit: false, canManage: false, role };
  if (space.visibility === "PRIVATE" && !member) return { canView: false, canEdit: false, canManage: false, role };
  const canEditPerm = hasPermission(user.permissions, "docs:edit");
  const canEdit = canEditPerm && (member ? member.role !== "viewer" : true);
  const canManage = canEditPerm && (member?.role === "owner" || space.createdById === user.id);
  return { canView: true, canEdit, canManage, role };
}

/** 当前用户可见空间的查询条件 */
export function visibleSpaceWhere(user: DocUser): Prisma.SpaceWhereInput {
  if (!hasPermission(user.permissions, "docs:view")) return { id: "__none__" };
  const own = { ownerId: user.id };
  if (isDocsAdmin(user)) return { OR: [{ ownerId: null }, own] };
  return { OR: [{ ownerId: null, visibility: "PUBLIC" }, { ownerId: null, members: { some: { userId: user.id } } }, own] };
}

export async function loadDocUser(userId: string, client: DbClient = db) {
  const u = await client.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, avatarColor: u.avatarColor, permissions: parsePermissions(u.role.permissions) };
}

export async function getDocAccess(user: DocUser, documentId: string, client: DbClient = db) {
  if ((await getDisabledApps(client)).has("docs")) return null;
  const doc = await client.document.findUnique({
    where: { id: documentId },
    include: { space: { include: { members: { select: { userId: true, role: true } } } } },
  });
  if (!doc) return null;
  const access = spaceAccess(doc.space, user);
  return {
    doc,
    access,
    canRead: access.canView,
    canWrite: access.canEdit && !doc.deletedAt,
  };
}

export async function getSpaceAccess(user: DocUser, spaceId: string, client: DbClient = db) {
  const space = await client.space.findUnique({
    where: { id: spaceId },
    include: { members: { select: { userId: true, role: true } } },
  });
  if (!space) return null;
  return { space, access: spaceAccess(space, user) };
}
