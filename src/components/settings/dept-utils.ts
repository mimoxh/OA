export type DeptNode = { id: string; name: string; parentId: string | null; sortOrder: number };

/** 按树形顺序展开部门，depth 用于缩进显示 */
export function flattenDepartments<T extends DeptNode>(list: T[]): (T & { depth: number })[] {
  const byParent = new Map<string | null, T[]>();
  for (const d of list) {
    const key = d.parentId && list.some((x) => x.id === d.parentId) ? d.parentId : null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(d);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"));
  const out: (T & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const d of byParent.get(parent) ?? []) {
      out.push({ ...d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function deptOptionLabel(d: { name: string; depth: number }) {
  return `${"　".repeat(d.depth)}${d.depth ? "└ " : ""}${d.name}`;
}
