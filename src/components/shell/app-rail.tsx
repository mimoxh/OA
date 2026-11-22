"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  BookUser,
  CalendarDays,
  FileText,
  Inbox,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { NAV_MODULES } from "@/lib/nav";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { logout } from "@/app/login/actions";
import { openCommandPalette } from "./command-palette";
import { useUnreadCount } from "./use-unread";
import { resetIm, useTotalUnread } from "@/components/im/store";
import { stopRealtime } from "@/components/realtime/provider";

export type ShellUser = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  roleName: string;
  permissions: string[];
};

function RailItem({
  href,
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "relative flex size-9 items-center justify-center rounded-lg transition-colors [&>svg]:size-5",
          active ? "bg-active text-accent" : "text-ink-2 hover:bg-hover",
        )}
      >
        {icon}
        {badge}
      </span>
      <span className={cn("text-[11px] leading-tight", active ? "text-ink" : "text-ink-2")}>{label}</span>
    </>
  );
  const cls = "flex w-full flex-col items-center gap-0.5 py-1";
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

function badgeNode(n: number) {
  return n > 0 ? (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white">
      {n > 99 ? "99+" : n}
    </span>
  ) : undefined;
}

export function AppRail({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const unread = useUnreadCount();
  const imUnread = useTotalUnread();
  const isAdmin = hasPermission(user.permissions, "admin");
  const settingsHref = isAdmin ? "/settings/members" : "/settings/profile";

  // 未读消息数同步到标签页标题
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = imUnread > 0 ? `(${imUnread > 99 ? "99+" : imUnread}) ${base}` : base;
  }, [imUnread, pathname]);

  const inModule = NAV_MODULES.some((m) => pathname === m.href || pathname.startsWith(m.href + "/"));
  const workActive = pathname === "/work" || pathname.startsWith("/work/") || (inModule && !pathname.startsWith("/oa/calendar"));

  const items = [
    { label: "消息", href: "/messages", icon: <MessageCircle />, show: true, active: pathname.startsWith("/messages"), badge: badgeNode(imUnread) },
    {
      label: "收件箱",
      href: "/inbox",
      icon: <Inbox />,
      show: true,
      active: pathname.startsWith("/inbox"),
      badge: badgeNode(unread),
    },
    { label: "云文档", href: "/docs", icon: <FileText />, show: hasPermission(user.permissions, "docs:view"), active: pathname.startsWith("/docs") },
    { label: "日历", href: "/oa/calendar", icon: <CalendarDays />, show: hasPermission(user.permissions, "oa:view"), active: pathname.startsWith("/oa/calendar") },
    { label: "工作台", href: "/work", icon: <LayoutGrid />, show: true, active: workActive },
    { label: "通讯录", href: "/contacts", icon: <BookUser />, show: true, active: pathname.startsWith("/contacts") },
  ];

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center border-r border-line bg-sidebar">
      <div className="pt-2">
        <Menu>
          <MenuTrigger asChild>
            <button className="rounded-full hover:ring-2 hover:ring-line-strong" aria-label="账户">
              <Avatar name={user.name} color={user.avatarColor} size={32} />
            </button>
          </MenuTrigger>
          <MenuContent className="w-64" side="right" align="start">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <Avatar name={user.name} color={user.avatarColor} size={32} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user.name}</div>
                <div className="truncate text-xs text-ink-3">{user.email}</div>
              </div>
            </div>
            <MenuLabel>{user.roleName}</MenuLabel>
            <MenuSeparator />
            <MenuItem icon={<UserRound />} asChild>
              <Link href="/settings/profile">个人资料</Link>
            </MenuItem>
            <MenuItem icon={<Settings />} asChild>
              <Link href={settingsHref}>设置</Link>
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<LogOut />}
              onSelect={() => {
                stopRealtime();
                resetIm();
                void logout();
              }}
            >
              退出登录
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <nav className="mt-1 flex w-full flex-1 flex-col items-center gap-0.5 px-1.5">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <RailItem key={i.label} href={i.href} icon={i.icon} label={i.label} active={i.active} badge={i.badge} />
          ))}
      </nav>

      <div className="flex w-full flex-col items-center gap-0.5 px-1.5 pb-2">
        <RailItem icon={<Search />} label="搜索" onClick={() => openCommandPalette()} />
        <RailItem href={settingsHref} icon={<Settings />} label="设置" active={pathname.startsWith("/settings")} />
      </div>
    </aside>
  );
}
