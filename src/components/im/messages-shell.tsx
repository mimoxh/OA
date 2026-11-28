"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

const MOBILE_QUERY = "(width < 48rem)";

/** 手机布局（< md）：/messages 只显示会话列表，进入会话后列表隐藏、聊天全屏；桌面端两栏并排不变 */
export function MessagesShell({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  const inChat = useSelectedLayoutSegment() !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const listTop = useRef(0);

  useEffect(() => {
    const el = panelRef.current?.querySelector<HTMLElement>("[data-panel-scroll]");
    if (!el) return;
    // 列表被 display:none 隐藏时会把 scrollTop 归零，只记录可见时的位置
    const onScroll = () => {
      if (el.clientHeight > 0) listTop.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (inChat || !window.matchMedia(MOBILE_QUERY).matches) return;
    const el = panelRef.current?.querySelector<HTMLElement>("[data-panel-scroll]");
    if (el && el.scrollTop !== listTop.current) el.scrollTop = listTop.current;
  }, [inChat]);

  return (
    <div className="flex min-h-app">
      <div ref={panelRef} className={cn("contents", inChat && "max-md:hidden")}>
        {panel}
      </div>
      <div className={cn("min-w-0 flex-1", !inChat && "max-md:hidden")}>{children}</div>
    </div>
  );
}
