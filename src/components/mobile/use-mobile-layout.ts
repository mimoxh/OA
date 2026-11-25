"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(width < 48rem)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** 是否为手机布局（< md 断点，与 Tailwind 的 max-md: 一致）。服务端渲染与首帧为 false。 */
export function useIsMobileLayout(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}

/** 底部标签栏所在的一级页面；其余页面在手机布局下显示返回按钮、隐藏标签栏 */
export const TAB_ROOTS = ["/messages", "/contacts", "/work", "/me"] as const;

export function isTabRoot(pathname: string) {
  return (TAB_ROOTS as readonly string[]).includes(pathname);
}
