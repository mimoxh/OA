import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 基于查询参数的 Tab（服务端计算激活态，保留其他筛选条件之外的参数由调用方决定） */
export function QueryTabs({ items, className }: { items: { href: string; label: ReactNode; count?: number; active: boolean }[]; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1 border-b border-line", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "relative -mb-px flex h-9 items-center gap-1.5 px-2 text-sm transition-colors",
            item.active
              ? "text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {item.label}
          {item.count !== undefined && <span className="rounded bg-hover px-1 text-[11px] tabular-nums text-ink-2">{item.count}</span>}
        </Link>
      ))}
    </div>
  );
}
