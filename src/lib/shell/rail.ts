import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/dal";
import type { ModuleKey } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import { visibleSpaceWhere } from "@/lib/docs/access";
import { railPinProjectId } from "@/lib/nav";

export type RailProject = { id: string; name: string; icon: string; color: string };
export type RailRecentDoc = { id: string; title: string; icon: string | null; kind: string };

/** 左侧导航栏需要的数据：固定的项目、最近打开的文档 */
export async function getRailData(user: CurrentUser, enabled: Set<ModuleKey>) {
  const projectIds = user.railPins.flatMap((k) => railPinProjectId(k) ?? []);
  const canPms = enabled.has("pms") && hasPermission(user.permissions, "pms:view");
  const canDocs = enabled.has("docs") && hasPermission(user.permissions, "docs:view");
  const [projects, recents] = await Promise.all([
    canPms && projectIds.length
      ? db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, icon: true, color: true } })
      : Promise.resolve([] as RailProject[]),
    canDocs
      ? db.documentRecent.findMany({
          where: { userId: user.id, document: { deletedAt: null, isTemplate: false, space: visibleSpaceWhere(user) } },
          orderBy: { openedAt: "asc" },
          select: { document: { select: { id: true, title: true, icon: true, kind: true } } },
        })
      : Promise.resolve([] as { document: RailRecentDoc }[]),
  ]);
  return { projects: projects as RailProject[], recentDocs: recents.map((r) => r.document) };
}
