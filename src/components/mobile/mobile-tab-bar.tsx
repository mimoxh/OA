"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, type ReactNode } from "react";
import { BookUser, LayoutGrid, MessageCircle, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { isTabRoot } from "./use-mobile-layout";

function count(n: number) {
  return n > 99 ? "99+" : String(n);
}

function Tab({ href, icon, label, active, badge }: { href: string; icon: ReactNode; label: string; active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      replace
      className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[11px]", active ? "text-accent" : "text-ink-2")}
      aria-current={active ? "page" : undefined}
    >
      <span className="relative [&>svg]:size-6">
        {icon}
        {!!badge && badge > 0 && (
          <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white">
            {count(badge)}
          </span>
        )}
      </span>
      <span>{label}</span>
    </Link>
  );
}

/** 手机布局（< md）的底部标签栏：只在四个一级页面显示，进入二级页面后隐藏 */
export function MobileTabBar({ imUnread, inboxUnread }: { imUnread: number; inboxUnread: number }) {
  const pathname = usePathname();
  const visible = isTabRoot(pathname);

  useLayoutEffect(() => {
    const el = document.documentElement;
    if (visible) el.dataset.tabbar = "";
    else delete el.dataset.tabbar;
  }, [visible]);

  if (!visible) return null;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white/95 pb-[var(--sab)] backdrop-blur md:hidden"
      aria-label="主导航"
    >
      <Tab href="/messages" icon={<MessageCircle />} label="消息" active={pathname === "/messages"} badge={imUnread} />
      <Tab href="/contacts" icon={<BookUser />} label="通讯录" active={pathname === "/contacts"} />
      <Tab href="/work" icon={<LayoutGrid />} label="工作" active={pathname === "/work"} badge={inboxUnread} />
      <Tab href="/me" icon={<UserRound />} label="我的" active={pathname === "/me"} />
    </nav>
  );
}
