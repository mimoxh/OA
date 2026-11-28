"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return {
    params,
    set(param: string, value: string) {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(param, value);
      else next.delete(param);
      next.delete("page");
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
    },
  };
}

const control =
  "h-7 rounded-md border border-line-strong bg-white px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15";

/** 同步到 URL 查询参数的下拉筛选 */
export function UrlSelect({
  param,
  options,
  placeholder,
  className,
}: {
  param: string;
  options: { value: string; label: string }[];
  placeholder: string;
  className?: string;
}) {
  const { params, set } = useParamSetter();
  return (
    <select value={params.get(param) ?? ""} onChange={(e) => set(param, e.target.value)} className={cn(control, "max-w-56 pr-6", className)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function UrlDate({ param, label }: { param: string; label: ReactNode }) {
  const { params, set } = useParamSetter();
  return (
    <label className="flex items-center gap-1 text-[13px] text-ink-2 max-md:min-w-0 max-md:flex-1">
      {label}
      <input
        type="date"
        value={params.get(param) ?? ""}
        onChange={(e) => set(param, e.target.value)}
        className={cn(control, "w-36 max-md:h-9 max-md:w-auto max-md:min-w-0 max-md:flex-1")}
      />
    </label>
  );
}

export function UrlToggle({ param, label }: { param: string; label: ReactNode }) {
  const { params, set } = useParamSetter();
  const on = params.get(param) === "1";
  return (
    <label className="inline-flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover">
      <input type="checkbox" checked={on} onChange={(e) => set(param, e.target.checked ? "1" : "")} className="size-3.5 accent-accent" />
      {label}
    </label>
  );
}

/** 清空全部筛选 */
export function ClearFilters({ keys }: { keys: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!keys.some((k) => params.get(k))) return null;
  return (
    <button
      onClick={() => {
        const next = new URLSearchParams(params.toString());
        keys.forEach((k) => next.delete(k));
        next.delete("page");
        router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
      }}
      className="h-7 rounded-md px-2 text-[13px] text-ink-3 hover:bg-hover hover:text-ink"
    >
      清除筛选
    </button>
  );
}
