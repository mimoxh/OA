import "server-only";
import { db } from "@/lib/db";
import { getMemberOptions } from "@/lib/oa/server";

export async function loadDesignerOptions() {
  const [members, roles, departments] = await Promise.all([
    getMemberOptions(),
    db.role.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { users: true } } } }),
    db.department.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { manager: { select: { name: true } } } }),
  ]);
  return {
    members,
    roles: roles.map((r) => ({ key: r.key, name: r.name, count: r._count.users })),
    departments: departments.map((d) => ({ id: d.id, name: d.name, manager: d.manager?.name ?? null })),
  };
}
