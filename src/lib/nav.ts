import {
  Building2,
  ClipboardCheck,
  FolderKanban,
  Landmark,
  Package,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { hasPermission, type Permission } from "@/lib/permissions";

export type NavLink = { href: string; label: string; perm?: Permission };
export type NavModule = {
  key: string;
  label: string;
  /** 固定到左侧导航栏时显示的短名称 */
  shortLabel: string;
  icon: LucideIcon;
  color: string;
  href: string;
  perm: Permission;
  items: NavLink[];
};

export const NAV_MODULES: NavModule[] = [
  {
    key: "oa",
    shortLabel: "OA",
    label: "OA 办公",
    icon: ClipboardCheck,
    color: "#e16b16",
    href: "/oa",
    perm: "oa:view",
    items: [
      { href: "/oa", label: "工作台" },
      { href: "/oa/approvals", label: "审批中心" },
      { href: "/oa/announcements", label: "公告通知" },
      { href: "/oa/calendar", label: "日程会议" },
      { href: "/oa/flows", label: "流程管理", perm: "oa:edit" },
    ],
  },
  {
    key: "crm",
    shortLabel: "客户",
    label: "CRM 客户",
    icon: Users,
    color: "#d44c8a",
    href: "/crm",
    perm: "crm:view",
    items: [
      { href: "/crm", label: "销售概览" },
      { href: "/crm/customers", label: "客户" },
      { href: "/crm/opportunities", label: "商机" },
      { href: "/crm/followups", label: "跟进记录" },
    ],
  },
  {
    key: "erp",
    shortLabel: "ERP",
    label: "ERP 企业资源",
    icon: Building2,
    color: "#2383e2",
    href: "/erp",
    perm: "erp:view",
    items: [
      { href: "/erp", label: "经营概览" },
      { href: "/erp/products", label: "产品" },
      { href: "/erp/suppliers", label: "供应商" },
      { href: "/erp/purchase", label: "采购订单" },
      { href: "/erp/sales", label: "销售订单" },
    ],
  },
  {
    key: "finance",
    shortLabel: "财务",
    label: "财务",
    icon: Landmark,
    color: "#448361",
    href: "/finance",
    perm: "finance:view",
    items: [
      { href: "/finance", label: "财务概览" },
      { href: "/finance/invoices", label: "应收应付" },
      { href: "/finance/payments", label: "收付款记录" },
      { href: "/finance/vouchers", label: "记账凭证" },
      { href: "/finance/accounts", label: "科目余额" },
    ],
  },
  {
    key: "wms",
    shortLabel: "仓储",
    label: "WMS 仓储",
    icon: Warehouse,
    color: "#9065b0",
    href: "/wms",
    perm: "wms:view",
    items: [
      { href: "/wms", label: "仓储概览" },
      { href: "/wms/inventory", label: "库存" },
      { href: "/wms/inbound", label: "入库单" },
      { href: "/wms/outbound", label: "出库单" },
      { href: "/wms/movements", label: "库存流水" },
      { href: "/wms/warehouses", label: "仓库与库位" },
    ],
  },
  {
    key: "tms",
    shortLabel: "运输",
    label: "TMS 运输",
    icon: Truck,
    color: "#cb912f",
    href: "/tms",
    perm: "tms:view",
    items: [
      { href: "/tms", label: "调度中心" },
      { href: "/tms/orders", label: "运输单" },
      { href: "/tms/vehicles", label: "车辆" },
      { href: "/tms/drivers", label: "司机" },
      { href: "/tms/routes", label: "线路" },
    ],
  },
  {
    key: "pms",
    shortLabel: "项目",
    label: "PMS 项目",
    icon: FolderKanban,
    color: "#337ea9",
    href: "/pms",
    perm: "pms:view",
    items: [
      { href: "/pms", label: "全部项目" },
      { href: "/pms/my-tasks", label: "我的任务" },
    ],
  },
];

/** 模块下的子页面（不含模块首页本身），按权限过滤 */
export function moduleSubPages(moduleKey: string, permissions: readonly string[]): NavLink[] {
  const mod = NAV_MODULES.find((m) => m.key === moduleKey);
  if (!mod) return [];
  return mod.items.filter((i) => i.href !== mod.href && (!i.perm || hasPermission(permissions, i.perm)));
}

export const PRODUCT_ICON = Package;

export const RAIL_PROJECT_PREFIX = "project:";
const PROJECT_PIN = /^project:[A-Za-z0-9_-]{1,64}$/;

/** 可固定到左侧导航栏的 key：应用 key 或 project:<项目 id> */
export function isRailPinKey(key: unknown): key is string {
  return typeof key === "string" && (NAV_MODULES.some((m) => m.key === key) || PROJECT_PIN.test(key));
}

export function railPinProjectId(key: string) {
  return key.startsWith(RAIL_PROJECT_PREFIX) ? key.slice(RAIL_PROJECT_PREFIX.length) : null;
}

function parseStringArray(json: string | null | undefined): unknown[] {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 解析 User.railPins，丢弃未知或重复的 key */
export function parseRailPins(json: string | null | undefined): string[] {
  return [...new Set(parseStringArray(json).filter(isRailPinKey))];
}

export const RAIL_ORDER_MAX = 200;
const RAIL_ID = /^[@A-Za-z0-9:_-]{1,80}$/;

export function isRailOrderId(id: unknown): id is string {
  return typeof id === "string" && RAIL_ID.test(id);
}

/** 解析 User.railOrder：左侧导航栏图标的自定义顺序 */
export function parseRailOrder(json: string | null | undefined): string[] {
  return [...new Set(parseStringArray(json).filter(isRailOrderId))].slice(0, RAIL_ORDER_MAX);
}
