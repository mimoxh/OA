"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 以单个查询参数区分的 Tab（切换时清空其他筛选参数，筛选时保持高亮） */
export function QueryTabs({
  param = "tab",
  items,
  defaultValue,
  keep = [],
  className,
}: {
  param?: string;
  items: { value: string; label: ReactNode; count?: number }[];
  defaultValue: string;
  keep?: string[];
  className?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search.get(param) ?? defaultValue;
  return (
    <div className={cn("flex items-center gap-1 border-b border-line", className)}>
      {items.map((item) => {
        const next = new URLSearchParams();
        for (const k of keep) {
          const v = search.get(k);
          if (v) next.set(k, v);
        }
        if (item.value !== defaultValue) next.set(param, item.value);
        const href = `${pathname}${next.toString() ? `?${next}` : ""}`;
        const active = current === item.value;
        return (
          <Link
            key={item.value}
            href={href}
            className={cn(
              "relative -mb-px flex h-9 items-center gap-1.5 px-2 text-sm transition-colors",
              active ? "text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className={cn("rounded px-1 text-[11px] tabular-nums", active ? "bg-ink text-white" : "bg-hover text-ink-2")}>{item.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
