import "server-only";
import { db } from "@/lib/db";
import { hasPermission, parsePermissions } from "@/lib/permissions";
import { spaceAccess, visibleSpaceWhere, type DocUser, type SpaceLike } from "./access";
import { ensurePersonalSpace } from "./personal";

export type TreeDoc = {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  spaceId: string;
  kind: string;
};
export type NavSpace = {
  id: string;
  name: string;
  icon: string;
  visibility: "PUBLIC" | "PRIVATE";
  personal: boolean;
  canEdit: boolean;
  canManage: boolean;
};
export type MemberOption = { id: string; name: string; avatarColor: string; title: string | null };

/** 当前用户可见的空间（个人空间排在最前；老用户首次进入时补建个人空间） */
export async function listVisibleSpaces(user: DocUser) {
  if (hasPermission(user.permissions, "docs:view")) await ensurePersonalSpace(db, user.id);
  const spaces = await db.space.findMany({
    where: visibleSpaceWhere(user),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { members: { select: { userId: true, role: true } } },
  });
  return spaces.sort((a, b) => Number(!!b.ownerId) - Number(!!a.ownerId));
}

export async function getDocsNav(user: DocUser) {
  const spaces = await listVisibleSpaces(user);
  const spaceIds = spaces.map((s) => s.id);
  const [docs, favorites] = await Promise.all([
    db.document.findMany({
      where: { spaceId: { in: spaceIds }, deletedAt: null, isTemplate: false, kind: { not: "row" } },
      select: { id: true, title: true, icon: true, parentId: true, spaceId: true, kind: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.documentFavorite.findMany({
      where: { userId: user.id, document: { deletedAt: null, isTemplate: false, kind: { not: "row" }, spaceId: { in: spaceIds } } },
      select: { documentId: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const navSpaces: NavSpace[] = spaces.map((s) => {
    const a = spaceAccess(s, user);
    return {
      id: s.id,
      name: s.name,
      icon: s.icon,
      visibility: s.visibility,
      personal: !!s.ownerId,
      canEdit: a.canEdit,
      canManage: a.canManage,
    };
  });
  return { spaces: navSpaces, docs: docs as TreeDoc[], favoriteIds: favorites.map((f) => f.documentId) };
}

export async function getAncestors(parentId: string | null) {
  const out: { id: string; title: string; icon: string | null }[] = [];
  let cur = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur) && out.length < 20) {
    seen.add(cur);
    const d: { id: string; title: string; icon: string | null; parentId: string | null } | null = await db.document.findUnique({
      where: { id: cur },
      select: { id: true, title: true, icon: true, parentId: true },
    });
    if (!d) break;
    out.unshift({ id: d.id, title: d.title, icon: d.icon });
    cur = d.parentId;
  }
  return out;
}

/** 可以在该空间文档中 @ 的成员：私有空间为空间成员与管理员，公开空间为所有有文档权限的成员 */
export async function getMentionableUsers(space: SpaceLike): Promise<MemberOption[]> {
  const users = await db.user.findMany({
    where: { active: true, isBot: false },
    select: { id: true, name: true, avatarColor: true, title: true, role: { select: { permissions: true } } },
    orderBy: { createdAt: "asc" },
  });
  return users
    .filter((u) => spaceAccess(space, { id: u.id, permissions: parsePermissions(u.role.permissions) }).canView)
    .map((u) => ({ id: u.id, name: u.name, avatarColor: u.avatarColor, title: u.title }));
}

export async function getAllActiveUsers(): Promise<(MemberOption & { canDocs: boolean })[]> {
  const users = await db.user.findMany({
    where: { active: true, isBot: false },
    select: { id: true, name: true, avatarColor: true, title: true, role: { select: { permissions: true } } },
    orderBy: { createdAt: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    avatarColor: u.avatarColor,
    title: u.title,
    canDocs: hasPermission(parsePermissions(u.role.permissions), "docs:view"),
  }));
}
