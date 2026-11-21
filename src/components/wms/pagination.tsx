import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchParamsRecord } from "@/lib/wms/params";

function href(basePath: string, sp: SearchParamsRecord, page: number) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page" || v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
    else next.set(k, v);
  }
  if (page > 1) next.set("page", String(page));
  const s = next.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function Pagination({
  basePath,
  searchParams,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  searchParams: SearchParamsRecord;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const item = "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[13px]";
  const nums: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <div className="mt-3 flex items-center justify-between text-[13px] text-ink-2">
      <span>
        第 {from}-{to} 条，共 {total} 条
      </span>
      <div className="flex items-center gap-0.5">
        {page > 1 ? (
          <Link href={href(basePath, searchParams, page - 1)} className={cn(item, "hover:bg-hover")} aria-label="上一页">
            <ChevronLeft className="size-4" />
          </Link>
        ) : (
          <span className={cn(item, "text-ink-3/60")}>
            <ChevronLeft className="size-4" />
          </span>
        )}
        {nums.map((n) => (
          <Link key={n} href={href(basePath, searchParams, n)} className={cn(item, n === page ? "bg-ink text-white" : "hover:bg-hover")}>
            {n}
          </Link>
        ))}
        {page < pages ? (
          <Link href={href(basePath, searchParams, page + 1)} className={cn(item, "hover:bg-hover")} aria-label="下一页">
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(item, "text-ink-3/60")}>
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </div>
  );
}
