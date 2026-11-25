"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { navigateBack } from "./nav-stack";
import { isTabRoot } from "./use-mobile-layout";

/** 手机布局下二级页面顶栏左侧的返回按钮（一级标签页不显示）；没有站内上一页时回到所属一级页面 */
export function MobileBack() {
  const pathname = usePathname();
  const router = useRouter();
  if (isTabRoot(pathname)) return null;
  return (
    <button
      type="button"
      onClick={() => navigateBack(router, pathname)}
      className="-ml-1.5 shrink-0 rounded-md p-1 text-ink-2 active:bg-hover md:hidden"
      aria-label="返回"
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}
