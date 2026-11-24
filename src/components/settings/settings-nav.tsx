"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Building, KeyRound, LayoutGrid, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const ITEMS: { href: string; label: string; icon: ReactNode; admin?: boolean; group: string }[] = [
  { href: "/settings/profile", label: "个人资料", icon: <UserRound />, group: "账号" },
  { href: "/settings/members", label: "成员", icon: <Users />, admin: true, group: "组织管理" },
  { href: "/settings/departments", label: "部门", icon: <Building />, admin: true, group: "组织管理" },
  { href: "/settings/roles", label: "角色权限", icon: <KeyRound />, admin: true, group: "组织管理" },
  { href: "/settings/apps", label: "应用管理", icon: <LayoutGrid />, admin: true, group: "系统" },
  { href: "/settings/webhooks", label: "Webhook 机器人", icon: <Bot />, admin: true, group: "系统" },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.admin || isAdmin);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <nav className="sticky top-0 hidden h-app w-[200px] shrink-0 border-r border-line px-2 pt-4 md:block">
      <div className="mb-3 px-2 text-sm font-semibold text-ink">设置</div>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <div className="mb-1 px-2 text-xs text-ink-3">{g}</div>
          {items
            .filter((i) => i.group === g)
            .map((i) => {
              const active = pathname === i.href || pathname.startsWith(i.href + "/");
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  className={cn(
                    "flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-hover [&>svg]:size-4",
                    active && "bg-active/70 font-medium text-ink",
                  )}
                >
                  {i.icon}
                  {i.label}
                </Link>
              );
            })}
        </div>
      ))}
    </nav>
  );
}
