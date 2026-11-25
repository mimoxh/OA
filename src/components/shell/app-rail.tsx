"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
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
  X,
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
import { setRailOrder, setRailPin } from "@/app/(app)/work/actions";
import { closeRecentDoc } from "@/app/(app)/docs/recent-actions";
import { DOC_META_EVENT, type DocMetaDetail } from "@/components/docs/events";
import type { RailProject, RailRecentDoc } from "@/lib/shell/rail";
import { RECENT_DOC_EVENT } from "./rail-events";
import { MobileTabBar } from "@/components/mobile/mobile-tab-bar";

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
      <span className={cn("max-w-full truncate px-0.5 text-[11px] leading-tight", active ? "text-ink" : "text-ink-2")}>{label}</span>
    </>
  );
  const cls = "flex w-full flex-col items-center gap-0.5 py-1";
  return href ? (
    // 由外层容器负责拖拽排序，链接本身不参与原生拖拽
    <Link href={href} className={cls} draggable={false}>
      {body}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

/** 固定到侧边栏的应用或项目：右键可移除 */
function PinnedMenu({ pinKey, children }: { pinKey: string; children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const unpin = () =>
    startTransition(async () => {
      const r = await setRailPin(pinKey, false);
      if (!r.ok) toast.error(r.error);
    });
  return (
    <CM.Root>
      <CM.Trigger asChild>
        <div className={cn("w-full", pending && "opacity-50")}>{children}</div>
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

type RailEntry = {
  id: string;
  href: string;
  icon: ReactNode;
  label: string;
  title?: string;
  active: boolean;
  badge?: ReactNode;
  pinKey?: string;
};

/** 按用户保存的顺序排列；未出现在顺序里的入口（新固定的、新启用的）保持默认相对顺序排在后面 */
function applyOrder(entries: RailEntry[], order: string[]) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const head = order.flatMap((id) => byId.get(id) ?? []);
  const seen = new Set(head.map((e) => e.id));
  return [...head, ...entries.filter((e) => !seen.has(e.id))];
}

function docIcon(d: RailRecentDoc) {
  return d.icon || (d.kind === "database" ? "🗃️" : d.kind === "whiteboard" ? "🎨" : "📄");
}

function badgeNode(n: number) {
  return n > 0 ? (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white">
      {n > 99 ? "99+" : n}
    </span>
  ) : undefined;
}
export function AppRail({
  user,
  enabledApps,
  railPins,
  railOrder,
  projects,
  recentDocs,
}: {
  user: ShellUser;
  enabledApps: string[];
  railPins: string[];
  railOrder: string[];
  projects: RailProject[];
  recentDocs: RailRecentDoc[];
}) {
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

  // 服务端数据变化（固定/取消固定、刷新）时同步到本地状态；拖拽与关闭文档先在本地即时生效
  const orderKey = railOrder.join(",");
  const [order, setOrder] = useState(railOrder);
  const [orderSrc, setOrderSrc] = useState(orderKey);
  if (orderSrc !== orderKey) {
    setOrderSrc(orderKey);
    setOrder(railOrder);
  }
  const docsKey = recentDocs.map((d) => `${d.id}:${d.title}:${d.icon}`).join("|");
  const [docs, setDocs] = useState(recentDocs);
  const [docsSrc, setDocsSrc] = useState(docsKey);
  if (docsSrc !== docsKey) {
    setDocsSrc(docsKey);
    setDocs(recentDocs);
  }
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; before: boolean } | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<RailRecentDoc>).detail;
      setDocs((list) => (list.some((x) => x.id === d.id) ? list : [...list, d]));
    };
    const onMeta = (e: Event) => {
      const { id, ...patch } = (e as CustomEvent<DocMetaDetail>).detail;
      setDocs((list) =>
        list.map((x) =>
          x.id === id ? { ...x, ...(patch.title !== undefined && { title: patch.title }), ...(patch.icon !== undefined && { icon: patch.icon }) } : x,
        ),
      );
    };
    window.addEventListener(RECENT_DOC_EVENT, onOpen);
    window.addEventListener(DOC_META_EVENT, onMeta);
    return () => {
      window.removeEventListener(RECENT_DOC_EVENT, onOpen);
      window.removeEventListener(DOC_META_EVENT, onMeta);
    };
  }, []);

  const inCalendar = pathname.startsWith("/oa/calendar");
  const inMod = (href: string) => !inCalendar && (pathname === href || pathname.startsWith(href + "/"));
  const pinnedApps = railPins.flatMap((k) => NAV_MODULES.filter((m) => m.key === k && canUse(m.key, m.perm)));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const pinnedProjects = canUse("pms", "pms:view") ? railPins.flatMap((k) => projectById.get(k.slice("project:".length)) ?? []) : [];
  const inProject = (id: string) => pathname === `/pms/projects/${id}`;
  const pinnedActive = pinnedApps.some((m) => inMod(m.href)) || pinnedProjects.some((p) => inProject(p.id));
  const workActive = pathname === "/work" || pathname.startsWith("/work/") || (!pinnedActive && NAV_MODULES.some((m) => inMod(m.href)));

  const builtins = [
    { id: "@messages", label: "消息", href: "/messages", icon: <MessageCircle />, show: true, active: pathname.startsWith("/messages"), badge: badgeNode(imUnread) },
    { id: "@inbox", label: "收件箱", href: "/inbox", icon: <Inbox />, show: true, active: pathname.startsWith("/inbox"), badge: badgeNode(unread) },
    { id: "@docs", label: "云文档", href: "/docs", icon: <FileText />, show: canUse("docs", "docs:view"), active: pathname.startsWith("/docs") },
    { id: "@calendar", label: "日历", href: "/oa/calendar", icon: <CalendarDays />, show: canUse("oa", "oa:view"), active: inCalendar },
    { id: "@work", label: "工作台", href: "/work", icon: <LayoutGrid />, show: true, active: workActive },
    { id: "@contacts", label: "通讯录", href: "/contacts", icon: <BookUser />, show: true, active: pathname.startsWith("/contacts") },
  ];
  const entries = applyOrder(
    [
      ...builtins.filter((b) => b.show).map((b) => ({ id: b.id, label: b.label, href: b.href, icon: b.icon, active: b.active, badge: b.badge })),
      ...pinnedApps.map((m) => {
        const Icon = m.icon;
        return { id: m.key, pinKey: m.key, href: m.href, icon: <Icon />, label: m.shortLabel, title: m.label, active: inMod(m.href) };
      }),
      ...pinnedProjects.map((p) => ({
        id: `project:${p.id}`,
        pinKey: `project:${p.id}`,
        href: `/pms/projects/${p.id}`,
        icon: (
          <span className="flex size-7 items-center justify-center rounded-md text-[17px] leading-none" style={{ backgroundColor: `${p.color}1f` }}>
            {p.icon}
          </span>
        ),
        label: p.name,
        title: `项目：${p.name}`,
        active: inProject(p.id),
      })),
    ],
    order,
  );

  const finishDrag = () => {
    setDragId(null);
    setDrop(null);
  };
  const dropOn = (targetId: string, before: boolean) => {
    const id = dragId;
    finishDrag();
    if (!id || id === targetId) return;
    const ids = entries.map((e) => e.id).filter((x) => x !== id);
    const at = ids.indexOf(targetId) + (before ? 0 : 1);
    ids.splice(at, 0, id);
    // 当前看不到的入口（如停用的应用）保留在原顺序末尾，重新出现时位置不丢
    const next = [...ids, ...order.filter((x) => !ids.includes(x))];
    setOrder(next);
    void setRailOrder(next).then((r) => {
      if (!r.ok) toast.error(r.error);
    });
  };
  const closeDoc = (id: string) => {
    setDocs((list) => list.filter((d) => d.id !== id));
    void closeRecentDoc(id).then((r) => {
      if (!r.ok) toast.error(r.error);
    });
  };
  return (
    <>
    <MobileTabBar imUnread={imUnread} inboxUnread={unread} />
      <aside data-tauri-drag-region className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center border-r border-line bg-sidebar max-md:hidden">
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
          {entries.map((e) => {
            const item = <RailItem href={e.href} icon={e.icon} label={e.label} active={e.active} badge={e.badge} />;
            const indicator = drop?.id === e.id && dragId !== e.id;
            return (
              <div
                key={e.id}
                title={e.title}
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData("text/plain", e.id);
                  ev.dataTransfer.effectAllowed = "move";
                  setDragId(e.id);
                }}
                onDragOver={(ev) => {
                  if (!dragId) return;
                  ev.preventDefault();
                  ev.dataTransfer.dropEffect = "move";
                  const r = ev.currentTarget.getBoundingClientRect();
                  const before = ev.clientY < r.top + r.height / 2;
                  if (drop?.id !== e.id || drop.before !== before) setDrop({ id: e.id, before });
                }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  dropOn(e.id, drop?.id === e.id ? drop.before : true);
                }}
                onDragEnd={finishDrag}
                className={cn("relative w-full", dragId === e.id && "opacity-40")}
              >
                {indicator && <span className={cn("absolute inset-x-2 h-0.5 rounded-full bg-accent", drop.before ? "-top-px" : "-bottom-px")} />}
                {e.pinKey ? <PinnedMenu pinKey={e.pinKey}>{item}</PinnedMenu> : item}
              </div>
            );
          })}
          {docs.length > 0 && <div className="my-1 h-px w-8 shrink-0 bg-line" />}
          {docs.map((d) => (
            <div key={d.id} className="group/doc relative w-full" title={d.title || "无标题"}>
              <RailItem
                href={`/docs/${d.id}`}
                icon={<span className="text-[18px] leading-none">{docIcon(d)}</span>}
                label={d.title || "无标题"}
                active={pathname === `/docs/${d.id}`}
              />
              <button
                type="button"
                aria-label={`关闭「${d.title || "无标题"}」`}
                title="关闭"
                onClick={() => closeDoc(d.id)}
                className="absolute right-1 top-0.5 hidden size-4 items-center justify-center rounded-full bg-white text-ink-3 shadow-sm ring-1 ring-line hover:text-ink group-hover/doc:flex [&>svg]:size-3"
              >
                <X />
              </button>
            </div>
          ))}
        </nav>

        <div className="flex w-full flex-col items-center gap-0.5 px-1.5 pb-2">
          <RailItem icon={<Search />} label="搜索" onClick={() => openCommandPalette()} />
          <RailItem href={settingsHref} icon={<Settings />} label="设置" active={pathname.startsWith("/settings")} />
        </div>
      </aside>
    </>
  );
}
