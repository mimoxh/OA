"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 日期区间筛选：同步到 ?from=&to= */
export function DateRangeFilter({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  function apply(f: string, t: string) {
    const next = new URLSearchParams(params.toString());
    if (f) next.set("from", f);
    else next.delete("from");
    if (t) next.set("to", t);
    else next.delete("to");
    setFrom(f);
    setTo(t);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  }

  const now = new Date();
  const presets: [string, string, string][] = [
    ["本月", fmt(new Date(now.getFullYear(), now.getMonth(), 1)), fmt(now)],
    ["上月", fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), fmt(new Date(now.getFullYear(), now.getMonth(), 0))],
    ["本年", fmt(new Date(now.getFullYear(), 0, 1)), fmt(now)],
  ];
  const input =
    "h-7 rounded-md border border-line-strong bg-white px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {presets.map(([label, f, t]) => (
        <button
          key={label}
          onClick={() => apply(f, t)}
          className={cn(
            "h-7 rounded-full px-2.5 text-[13px] transition-colors",
            from === f && to === t ? "bg-ink text-white" : "text-ink-2 hover:bg-hover",
          )}
        >
          {label}
        </button>
      ))}
      <button
        onClick={() => apply("", "")}
        className={cn("h-7 rounded-full px-2.5 text-[13px] transition-colors", !from && !to ? "bg-ink text-white" : "text-ink-2 hover:bg-hover")}
      >
        全部
      </button>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} aria-label="开始日期" />
      <span className="text-ink-3">—</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} aria-label="结束日期" />
      <Button size="sm" onClick={() => apply(from, to)}>
        查询
      </Button>
    </div>
  );
}
