import type { ReactNode } from "react";
import type { StatusMeta, TagColor } from "@/lib/labels";
import { cn } from "@/lib/utils";

const colors: Record<TagColor, string> = {
  gray: "bg-tag-gray text-tag-gray-ink",
  brown: "bg-tag-brown text-tag-brown-ink",
  orange: "bg-tag-orange text-tag-orange-ink",
  yellow: "bg-tag-yellow text-tag-yellow-ink",
  green: "bg-tag-green text-tag-green-ink",
  blue: "bg-tag-blue text-tag-blue-ink",
  purple: "bg-tag-purple text-tag-purple-ink",
  pink: "bg-tag-pink text-tag-pink-ink",
  red: "bg-tag-red text-tag-red-ink",
};

export function Badge({ color = "gray", children, className }: { color?: TagColor; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center whitespace-nowrap rounded px-1.5 text-xs leading-none", colors[color], className)}>
      {children}
    </span>
  );
}

/** 根据状态字典渲染标签：<StatusBadge map={SALES_STATUS} value={order.status} /> */
export function StatusBadge<T extends string>({ map, value, className }: { map: Record<T, StatusMeta>; value: T; className?: string }) {
  const m = map[value] ?? { label: value, color: "gray" as TagColor };
  return (
    <Badge color={m.color} className={className}>
      {m.label}
    </Badge>
  );
}

export function Dot({ color = "gray" }: { color?: TagColor }) {
  const dot: Record<TagColor, string> = {
    gray: "bg-[#9b9a97]",
    brown: "bg-[#9f6b53]",
    orange: "bg-[#d9730d]",
    yellow: "bg-[#cb912f]",
    green: "bg-[#448361]",
    blue: "bg-[#337ea9]",
    purple: "bg-[#9065b0]",
    pink: "bg-[#c14c8a]",
    red: "bg-[#d44c47]",
  };
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", dot[color])} />;
}
