"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "panel:collapsed";

/** 左侧二级面板（飞书风格）：标题 + 可滚动内容 + 可选底栏，可收起 */
export function ContextPanel({
  title,
  actions,
  footer,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  const toggle = (v: boolean) => {
    setCollapsed(v);
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  };

  // 收起后保留一条窄栏占位，避免展开按钮浮在页面内容（面包屑、标题）上
  if (collapsed) {
    return (
      <aside className="sticky top-0 flex h-app w-10 shrink-0 flex-col items-center border-r border-line bg-sidebar pt-2">
        <button
          onClick={() => toggle(false)}
          className="rounded-md p-1.5 text-ink-2 hover:bg-active/70 hover:text-ink"
          aria-label="展开面板"
          title="展开面板"
        >
          <ChevronsRight className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className={cn("group/panel sticky top-0 flex h-app w-[248px] shrink-0 flex-col border-r border-line bg-sidebar", className)}>
      <div className="flex items-center gap-1 px-3 pb-1 pt-3">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink [&_a]:flex [&_a]:items-center [&_a]:gap-1.5">{title}</div>
        {actions}
        <button
          onClick={() => toggle(true)}
          className="rounded-md p-1 text-ink-3 transition-opacity hover:bg-active/70 hover:text-ink md:opacity-0 md:group-hover/panel:opacity-100"
          aria-label="收起面板"
        >
          <ChevronsLeft className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{children}</div>
      {footer && <div className="border-t border-line px-2 py-2">{footer}</div>}
    </aside>
  );
}
