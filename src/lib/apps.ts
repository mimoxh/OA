import { MODULES, type ModuleKey } from "@/lib/permissions";

/** 应用硬依赖：ERP 依赖 OA 审批、WMS 出库、TMS 运输与财务收付款；其余应用无依赖 */
export const APP_REQUIRES: Record<ModuleKey, ModuleKey[]> = {
  docs: [],
  oa: [],
  crm: [],
  erp: ["oa", "wms", "tms", "finance"],
  finance: [],
  wms: [],
  tms: [],
  pms: [],
};

export function appName(key: ModuleKey) {
  return MODULES.find((m) => m.key === key)?.name ?? key;
}

/** 启用状态的应用中依赖 key 的应用 */
export function appDependents(key: ModuleKey, enabled: ReadonlySet<ModuleKey>): ModuleKey[] {
  return MODULES.filter((m) => enabled.has(m.key) && APP_REQUIRES[m.key].includes(key)).map((m) => m.key);
}

/** key 所依赖、但当前未启用的应用 */
export function missingRequirements(key: ModuleKey, enabled: ReadonlySet<ModuleKey>): ModuleKey[] {
  return APP_REQUIRES[key].filter((r) => !enabled.has(r));
}

/** 权限点 `<module>:view|edit` 对应的模块，非模块权限返回 null */
export function moduleOfPermission(p: string): ModuleKey | null {
  const key = p.split(":")[0];
  return MODULES.some((m) => m.key === key) && /:(view|edit)$/.test(p) ? (key as ModuleKey) : null;
}
