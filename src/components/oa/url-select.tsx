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
  return (
    <Select
      value={params.get(param) ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set(param, e.target.value);
        else next.delete(param);
        router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
      }}
      className={cn("h-7 w-40 text-[13px]", className)}
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
