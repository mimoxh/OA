"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

const DELAY_MS = 450;
const MOVE_TOLERANCE = 10;

/**
 * 触屏长按（鼠标不触发，桌面端行为不变）。触发后吞掉随后的 click 与系统长按菜单，
 * 避免长按图片时同时打开预览、长按文字时弹出系统选择菜单。
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType !== "touch") return;
      fired.current = false;
      clear();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        navigator.vibrate?.(10);
        onLongPress();
      }, DELAY_MS);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      if (!s || !timer.current) return;
      if (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: ReactMouseEvent) => {
      // 触屏长按会派发 contextmenu；鼠标右键（button 2）保持浏览器默认
      if (fired.current || timer.current) e.preventDefault();
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
