"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 手机布局（< md）：/messages 只显示会话列表，进入会话后列表隐藏、聊天全屏；桌面端两栏并排不变 */
export function MessagesShell({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  const inChat = useSelectedLayoutSegment() !== null;
  return (
    <div className="flex min-h-app">
      <div className={cn("contents", inChat && "max-md:hidden")}>{panel}</div>
      <div className={cn("min-w-0 flex-1", !inChat && "max-md:hidden")}>{children}</div>
    </div>
  );
}
