"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TabItem = { href: string; label: ReactNode; count?: number; exact?: boolean };

/** 基于路由的 Tab 导航。匹配规则：exact 时完全相等，否则前缀匹配；带查询参数时比较查询参数。 */
export function TabsNav({ items, className }: { items: TabItem[]; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = pathname + (search.toString() ? `?${search.toString()}` : "");

  function isActive(item: TabItem) {
    if (item.href.includes("?")) return current === item.href;
    if (item.exact) return pathname === item.href && !search.toString();
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    // 手机上标签多时横向滚动，不把每个标签挤成逐字换行
    <div className={cn("flex items-center gap-1 border-b border-line max-md:overflow-x-auto max-md:[scrollbar-width:none]", className)}>
      {items.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative -mb-px flex h-9 items-center gap-1.5 px-2 text-sm transition-colors max-md:shrink-0 max-md:whitespace-nowrap",
              active ? "text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="rounded bg-hover px-1 text-[11px] tabular-nums text-ink-2">{item.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
