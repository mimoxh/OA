"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function DocsTrashLink() {
  const pathname = usePathname();
  const active = pathname === "/docs/trash" || pathname.startsWith("/docs/trash/");
  return (
    <Link
      href="/docs/trash"
      className={cn(
        "group flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-active/70",
        active && "bg-active/80 font-medium text-ink",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Trash2 className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1 truncate">回收站</span>
    </Link>
  );
}
