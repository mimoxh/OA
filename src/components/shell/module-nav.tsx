"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_MODULES } from "@/lib/nav";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ContextPanel } from "./context-panel";

/** 业务模块二级导航（OA / CRM / ERP / 财务 / WMS / TMS / PMS） */
export function ModuleNav({
  moduleKey,
  permissions,
  hideOn,
}: {
  moduleKey: string;
  permissions: string[];
  hideOn?: string[];
}) {
  const pathname = usePathname();
  if (hideOn?.some((h) => pathname === h || pathname.startsWith(h + "/"))) return null;
  const mod = NAV_MODULES.find((m) => m.key === moduleKey);
  if (!mod) return null;
  const Icon = mod.icon;

  return (
    <ContextPanel
      title={
        <Link href={mod.href} className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-4 shrink-0" style={{ color: mod.color }} />
          <span className="truncate">{mod.label}</span>
        </Link>
      }
    >
      <nav className="space-y-px pt-1">
        {mod.items
          .filter((i) => !i.perm || hasPermission(permissions, i.perm))
          .map((i) => {
            const active = pathname === i.href || (i.href !== mod.href && pathname.startsWith(i.href + "/"));
            return (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  "flex h-[30px] items-center rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-active/70",
                  active && "bg-active/80 font-medium text-ink",
                )}
              >
                <span className="truncate">{i.label}</span>
              </Link>
            );
          })}
      </nav>
    </ContextPanel>
  );
}
