"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 下拉筛选：同步到 URL 查询参数 */
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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(param) ?? "";
  return (
    <Select
      value={current}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set(param, e.target.value);
        else next.delete(param);
        router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
      }}
      className={cn("h-7 w-auto min-w-28 text-[13px]", current ? "border-accent/50 text-accent" : "", className)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
