import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 视图切换（分段按钮），链接由调用方生成以保留其他查询参数 */
export function ViewSwitch({ items }: { items: { href: string; label: ReactNode; icon?: ReactNode; active: boolean }[] }) {
  return (
    <div className="inline-flex items-center rounded-md bg-hover p-0.5">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          scroll={false}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded px-2 text-[13px] transition-colors [&>svg]:size-3.5",
            i.active ? "bg-white text-ink shadow-card" : "text-ink-2 hover:text-ink",
          )}
        >
          {i.icon}
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/** 生成保留其他查询参数的链接 */
export function hrefWith(pathname: string, sp: Record<string, string | string[] | undefined>, patch: Record<string, string | null>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) next.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const s = next.toString();
  return s ? `${pathname}?${s}` : pathname;
}
