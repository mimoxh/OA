"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { isTabRoot } from "./use-mobile-layout";

/** 手机布局下二级页面顶栏左侧的返回按钮（一级标签页不显示）；没有历史记录时回到工作台 */
export function MobileBack() {
  const pathname = usePathname();
  const router = useRouter();
  if (isTabRoot(pathname)) return null;
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.replace("/work"))}
      className="-ml-1.5 shrink-0 rounded-md p-1 text-ink-2 active:bg-hover md:hidden"
      aria-label="返回"
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}
