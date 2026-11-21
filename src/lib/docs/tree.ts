import type { DbClient } from "@/lib/db";

/** 广度优先收集所有子孙页面 id（不含自身） */
export async function collectDescendantIds(client: DbClient, rootId: string, where: { deletedAt?: null | { not: null } } = {}) {
  const out: string[] = [];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await client.document.findMany({
      where: { parentId: { in: frontier }, ...where },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !out.includes(id) && id !== rootId);
    out.push(...frontier);
  }
  return out;
}

export async function isDescendant(client: DbClient, ancestorId: string, nodeId: string) {
  let cur: string | null = nodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    const row: { parentId: string | null } | null = await client.document.findUnique({ where: { id: cur }, select: { parentId: true } });
    cur = row?.parentId ?? null;
  }
  return false;
}
