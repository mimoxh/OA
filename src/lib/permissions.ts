export const MODULES = [
  { key: "docs", name: "文档", description: "知识库与协同文档" },
  { key: "oa", name: "OA 办公", description: "审批、公告、日程" },
  { key: "crm", name: "CRM 客户", description: "客户、商机、跟进" },
  { key: "erp", name: "ERP 企业资源", description: "产品、采购、销售" },
  { key: "finance", name: "财务", description: "应收应付、凭证" },
  { key: "wms", name: "WMS 仓储", description: "仓库、库存、出入库" },
  { key: "tms", name: "TMS 运输", description: "运输单、车辆、司机" },
  { key: "pms", name: "PMS 项目", description: "项目、任务、里程碑" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export type Permission = `${ModuleKey}:view` | `${ModuleKey}:edit` | "admin";

export const ALL_PERMISSIONS: Permission[] = [
  ...MODULES.flatMap((m) => [`${m.key}:view`, `${m.key}:edit`] as Permission[]),
  "admin",
];

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries([
  ...MODULES.flatMap((m) => [
    [`${m.key}:view`, `${m.name} · 查看`],
    [`${m.key}:edit`, `${m.name} · 编辑`],
  ]),
  ["admin", "系统管理员（全部权限）"],
]);

/** edit 权限隐含 view 权限；admin 拥有全部权限 */
export function hasPermission(perms: readonly string[], p: Permission): boolean {
  if (perms.includes("admin") || perms.includes(p)) return true;
  if (p.endsWith(":view")) return perms.includes(p.replace(":view", ":edit"));
  return false;
}

export function parsePermissions(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
