"use client";

import { useSyncExternalStore } from "react";

export const MOBILE_LAYOUT_QUERY = "(width < 48rem)";
const QUERY = MOBILE_LAYOUT_QUERY;

/** 手机布局，或以触屏为主要输入的设备（平板）：聚焦输入框会立即弹出软键盘 */
export const SOFT_KEYBOARD_QUERY = `${MOBILE_LAYOUT_QUERY}, (pointer: coarse)`;

/**
 * Radix 弹层的 onOpenAutoFocus：手机 / 触屏上不让焦点自动落到第一个输入框（否则一打开就弹出输入法遮住列表），
 * 改为聚焦弹层容器本身，方向键、Esc / 返回键、读屏仍可用；用户点按输入框时照常聚焦。桌面保持 Radix 默认行为。
 */
export function keepSoftKeyboardClosed(e: Event) {
  if (!window.matchMedia(SOFT_KEYBOARD_QUERY).matches) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
}

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
export { TAB_ROOTS, isTabRoot } from "./route-parent";
