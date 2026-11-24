"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useTransition, type ReactNode } from "react";
import { ContextMenu as CM } from "radix-ui";
import { toast } from "sonner";
import {
  BookUser,
  CalendarDays,
  FileText,
  Inbox,
  LayoutGrid,
  LogOut,
  MessageCircle,
  PinOff,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { NAV_MODULES } from "@/lib/nav";
import { hasPermission, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { logout } from "@/app/login/actions";
import { openCommandPalette } from "./command-palette";
import { useUnreadCount } from "./use-unread";
import { resetIm, useTotalUnread } from "@/components/im/store";
import { stopRealtime } from "@/components/realtime/provider";
import { setDesktopUnreadBadge } from "@/lib/desktop-bridge";
import { setRailPin } from "@/app/(app)/work/actions";

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

/** 固定到侧边栏的应用：右键可移除 */
function PinnedRailItem({ appKey, href, icon, label, fullLabel, active }: { appKey: string; href: string; icon: ReactNode; label: string; fullLabel: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const unpin = () =>
    startTransition(async () => {
      const r = await setRailPin(appKey, false);
      if (!r.ok) toast.error(r.error);
    });
  return (
    <CM.Root>
      <CM.Trigger asChild>
        <div className={cn("w-full", pending && "opacity-50")} title={fullLabel}>
          <RailItem href={href} icon={icon} label={label} active={active} />
        </div>
      </CM.Trigger>
      <CM.Portal>
        <CM.Content className="z-50 min-w-40 rounded-md bg-white p-1 text-sm shadow-pop animate-pop-in">
          <CM.Item
            onSelect={unpin}
            className="flex h-7 cursor-pointer select-none items-center gap-2 rounded px-2 text-ink outline-none data-[highlighted]:bg-hover [&>svg]:size-4 [&>svg]:text-ink-2"
          >
            <PinOff />
            从侧边栏移除
          </CM.Item>
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

function badgeNode(n: number) {
  return n > 0 ? (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white">
      {n > 99 ? "99+" : n}
    </span>
  ) : undefined;
}

export function AppRail({ user, enabledApps, railPins }: { user: ShellUser; enabledApps: string[]; railPins: string[] }) {
  const pathname = usePathname();
  const unread = useUnreadCount();
  const imUnread = useTotalUnread();
  const isAdmin = hasPermission(user.permissions, "admin");
  const canUse = (app: string, p: Permission) => enabledApps.includes(app) && hasPermission(user.permissions, p);
  const settingsHref = isAdmin ? "/settings/members" : "/settings/profile";

  // 未读消息数同步到标签页标题与桌面托盘
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = imUnread > 0 ? `(${imUnread > 99 ? "99+" : imUnread}) ${base}` : base;
    setDesktopUnreadBadge(imUnread);
  }, [imUnread, pathname]);

  const inCalendar = pathname.startsWith("/oa/calendar");
  const inMod = (href: string) => !inCalendar && (pathname === href || pathname.startsWith(href + "/"));
  const pinned = railPins.flatMap((k) => NAV_MODULES.filter((m) => m.key === k && canUse(m.key, m.perm)));
  const pinnedActive = pinned.some((m) => inMod(m.href));
  const workActive = pathname === "/work" || pathname.startsWith("/work/") || (!pinnedActive && NAV_MODULES.some((m) => inMod(m.href)));

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
    { label: "云文档", href: "/docs", icon: <FileText />, show: canUse("docs", "docs:view"), active: pathname.startsWith("/docs") },
    { label: "日历", href: "/oa/calendar", icon: <CalendarDays />, show: canUse("oa", "oa:view"), active: pathname.startsWith("/oa/calendar") },
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
                void import("@/components/call/store").then((m) => m.resetCallStore());
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

      <nav className="mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1.5 [scrollbar-width:none]">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <RailItem key={i.label} href={i.href} icon={i.icon} label={i.label} active={i.active} badge={i.badge} />
          ))}
        {pinned.length > 0 && <div className="my-1 h-px w-8 shrink-0 bg-line" />}
        {pinned.map((m) => {
          const Icon = m.icon;
          return (
            <PinnedRailItem
              key={m.key}
              appKey={m.key}
              href={m.href}
              icon={<Icon />}
              label={m.shortLabel}
              fullLabel={m.label}
              active={inMod(m.href)}
            />
          );
        })}
      </nav>

      <div className="flex w-full flex-col items-center gap-0.5 px-1.5 pb-2">
        <RailItem icon={<Search />} label="搜索" onClick={() => openCommandPalette()} />
        <RailItem href={settingsHref} icon={<Settings />} label="设置" active={pathname.startsWith("/settings")} />
      </div>
    </aside>
  );
}
