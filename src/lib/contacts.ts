/** 通讯录按部门筛选：只列出该部门的直属成员（与部门旁的人数一致），下级部门作为可继续点选的入口 */
export function contactsDeptScope<T extends { id: string; parentId: string | null }>(depts: T[], deptId: string): { memberDeptIds: string[]; children: T[] } | null {
  if (!deptId || !depts.some((d) => d.id === deptId)) return null;
  return { memberDeptIds: [deptId], children: depts.filter((d) => d.parentId === deptId && d.id !== deptId) };
}
