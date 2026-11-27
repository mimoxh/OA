"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * 左侧二级面板 + 内容区。桌面端两栏并排不变；手机布局（< md）一次只显示一栏：
 * 在 root 页面显示面板（整页列表），进入其他页面后隐藏面板、内容全屏。
 * mobileRootContent：root 页面本身就是列表（如 PMS 的全部项目）时，手机上 root 也显示内容、不显示面板。
 */
export function SplitFrame({
  root,
  panel,
  mobileRootContent,
  children,
}: {
  root: string;
  panel: ReactNode;
  mobileRootContent?: boolean;
  children: ReactNode;
}) {
  const atRoot = usePathname() === root && !mobileRootContent;
  return (
    <div className="flex min-h-app">
      <div className={cn("contents", !atRoot && "max-md:hidden")}>{panel}</div>
      <div className={cn("min-w-0 flex-1", atRoot && "max-md:hidden")}>{children}</div>
    </div>
  );
}
