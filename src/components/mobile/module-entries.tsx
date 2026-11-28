import Link from "next/link";
import {
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Factory,
  FileText,
  History,
  IdCard,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Megaphone,
  MessageSquareText,
  Package,
  PackageMinus,
  PackagePlus,
  Receipt,
  Route,
  Scale,
  ShoppingCart,
  Truck,
  Warehouse,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { moduleSubPages, NAV_MODULES } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  "/oa/approvals": ListChecks,
  "/oa/announcements": Megaphone,
  "/oa/calendar": CalendarDays,
  "/oa/flows": Workflow,
  "/crm/customers": Building2,
  "/crm/opportunities": Lightbulb,
  "/crm/followups": MessageSquareText,
  "/erp/products": Package,
  "/erp/suppliers": Factory,
  "/erp/purchase": ShoppingCart,
  "/erp/sales": Receipt,
  "/finance/invoices": FileText,
  "/finance/payments": CreditCard,
  "/finance/vouchers": BookOpen,
  "/finance/accounts": Scale,
  "/wms/inventory": Boxes,
  "/wms/inbound": PackagePlus,
  "/wms/outbound": PackageMinus,
  "/wms/movements": History,
  "/wms/warehouses": Warehouse,
  "/tms/orders": ClipboardList,
  "/tms/vehicles": Truck,
  "/tms/drivers": IdCard,
  "/tms/routes": Route,
};

/** 手机上模块首页顶部的子页面入口宫格（桌面端由左侧二级导航承担，不渲染） */
export function ModuleEntries({ moduleKey, permissions }: { moduleKey: string; permissions: string[] }) {
  const mod = NAV_MODULES.find((m) => m.key === moduleKey);
  if (!mod) return null;
  const items = moduleSubPages(moduleKey, permissions);
  if (!items.length) return null;
  return (
    <nav aria-label={`${mod.label}入口`} className="mb-5 grid grid-cols-4 gap-y-1 rounded-xl border border-line bg-white px-1 py-2 md:hidden" data-module-entries>
      {items.map((i) => {
        const Icon = ICONS[i.href] ?? LayoutGrid;
        return (
          <Link key={i.href} href={i.href} className="flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-1 py-2 active:bg-hover">
            <span className="flex size-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${mod.color}1a`, color: mod.color }}>
              <Icon className="size-5" />
            </span>
            <span className="w-full truncate text-center text-xs text-ink">{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
