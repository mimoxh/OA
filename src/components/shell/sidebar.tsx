"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  ChevronsLeft,
  Home,
  Inbox,
  LogOut,
  Menu as MenuIcon,
  Search,
  Settings,
  Trash2,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { NAV_MODULES } from "@/lib/nav";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { logout } from "@/app/login/actions";
import { openCommandPalette } from "./command-palette";

export type ShellUser = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  roleName: string;
  permissions: string[];
};

function SidebarLink({
  href,
  icon,
  children,
  active,
  right,
  className,
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  active?: boolean;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-active/70",
        active && "bg-active/80 font-medium text-ink",
        className,
      )}
    >
      {icon && <span className="flex size-5 shrink-0 items-center justify-center [&>svg]:size-[18px]">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </Link>
  );
}

export function useUnreadCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/notifications/unread")
        .then((r) => (r.ok ? r.json() : { count: 0 }))
        .then((d) => alive && setCount(d.count ?? 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("notifications:changed", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("notifications:changed", onFocus);
    };
  }, []);
  return count;
}

export function Sidebar({ user, docsSlot, enabledApps }: { user: ShellUser; docsSlot: ReactNode; enabledApps: string[] }) {
  const pathname = usePathname();
  const unread = useUnreadCount();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(localStorage.getItem("sidebar:collapsed") === "1");
    try {
      setOpen(JSON.parse(localStorage.getItem("sidebar:open") ?? "{}"));
    } catch {}
  }, []);

  const toggleCollapsed = (v: boolean) => {
    setCollapsed(v);
    localStorage.setItem("sidebar:collapsed", v ? "1" : "0");
  };
  const toggleModule = (key: string, v?: boolean) => {
    setOpen((prev) => {
      const next = { ...prev, [key]: v ?? !prev[key] };
      localStorage.setItem("sidebar:open", JSON.stringify(next));
      return next;
    });
  };

  const modules = NAV_MODULES.filter((m) => enabledApps.includes(m.key) && hasPermission(user.permissions, m.perm));
  const isAdmin = hasPermission(user.permissions, "admin");
  const docsEnabled = enabledApps.includes("docs") && hasPermission(user.permissions, "docs:view");

  if (collapsed) {
    return (
      <button
        onClick={() => toggleCollapsed(false)}
        className="fixed left-2 top-2 z-40 rounded-md p-1.5 text-ink-2 hover:bg-hover"
        aria-label="展开侧边栏"
      >
        <MenuIcon className="size-4" />
      </button>
    );
  }

  return (
    <aside className="group/sidebar sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-1 px-2 pt-2">
        <Menu>
          <MenuTrigger asChild>
            <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-active/70">
              <span className="flex size-5 items-center justify-center rounded bg-ink text-[11px] font-bold text-white">协</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">协作空间</span>
            </button>
          </MenuTrigger>
          <MenuContent className="w-64">
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
              <Link href={isAdmin ? "/settings/members" : "/settings/profile"}>设置</Link>
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} onSelect={() => logout()}>
              退出登录
            </MenuItem>
          </MenuContent>
        </Menu>
        <button
          onClick={() => toggleCollapsed(true)}
          className="rounded-md p-1 text-ink-3 opacity-0 transition-opacity hover:bg-active/70 hover:text-ink group-hover/sidebar:opacity-100"
          aria-label="收起侧边栏"
        >
          <ChevronsLeft className="size-4" />
        </button>
      </div>

      <div className="space-y-px px-2 pt-1">
        <button
          onClick={() => openCommandPalette()}
          className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-sm text-ink-2 hover:bg-active/70"
        >
          <span className="flex size-5 items-center justify-center">
            <Search className="size-[18px]" />
          </span>
          <span className="flex-1 text-left">搜索</span>
          <kbd className="text-[11px] text-ink-3">Ctrl K</kbd>
        </button>
        <SidebarLink href="/" icon={<Home />} active={pathname === "/"}>
          首页
        </SidebarLink>
        <SidebarLink
          href="/inbox"
          icon={<Inbox />}
          active={pathname.startsWith("/inbox")}
          right={
            unread > 0 ? (
              <span className="rounded-full bg-danger px-1.5 text-[11px] font-medium leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
            ) : null
          }
        >
          收件箱
        </SidebarLink>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="mb-1 px-2 text-xs font-medium text-ink-3">应用</div>
        <div className="space-y-px">
          {modules.map((m) => {
            const inModule = pathname === m.href || pathname.startsWith(m.href + "/");
            const expanded = open[m.key] ?? inModule;
            const Icon = m.icon;
            return (
              <div key={m.key}>
                <div
                  className={cn(
                    "group flex h-[30px] items-center rounded-md text-sm text-ink-2 hover:bg-active/70",
                    inModule && !expanded && "bg-active/80 text-ink",
                  )}
                >
                  <button
                    onClick={() => toggleModule(m.key, !expanded)}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-active"
                    aria-label={expanded ? "收起" : "展开"}
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
                  </button>
                  <Link href={m.href} className="flex min-w-0 flex-1 items-center gap-2 pr-2" onClick={() => toggleModule(m.key, true)}>
                    <Icon className="size-[17px] shrink-0" style={{ color: m.color }} />
                    <span className={cn("truncate", inModule && "font-medium text-ink")}>{m.label}</span>
                  </Link>
                </div>
                {expanded && (
                  <div className="mb-1 ml-[22px] space-y-px border-l border-line pl-1.5">
                    {m.items
                      .filter((i) => !i.perm || hasPermission(user.permissions, i.perm))
                      .map((i) => {
                        const active =
                          pathname === i.href ||
                          (i.href !== m.href && pathname.startsWith(i.href + "/"));
                        return (
                          <SidebarLink key={i.href} href={i.href} active={active} className="h-7 text-[13px]">
                            {i.label}
                          </SidebarLink>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {docsEnabled && <div className="mt-4">{docsSlot}</div>}
      </div>

      <div className="space-y-px border-t border-line px-2 py-2">
        {docsEnabled && (
          <SidebarLink href="/docs/trash" icon={<Trash2 />} active={pathname === "/docs/trash"}>
            回收站
          </SidebarLink>
        )}
        <SidebarLink href={isAdmin ? "/settings/members" : "/settings/profile"} icon={<Settings />} active={pathname.startsWith("/settings")}>
          设置
        </SidebarLink>
      </div>
    </aside>
  );
}
