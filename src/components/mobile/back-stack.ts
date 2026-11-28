"use client";

import { useEffect, useRef } from "react";

/**
 * 页面内自绘的全屏层（话题、搜索、群设置等）登记到这里，Android 返回键优先关闭最上层。
 * Radix 弹窗 / 菜单不需要登记：返回键会先给它们发 Escape。
 */
const stack: { id: number; close: () => void }[] = [];
let seq = 0;

export function popBackHandler(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top.close();
  return true;
}

/** active 为 true 时登记；onClose 用最新闭包 */
export function useBackHandler(active: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    const id = ++seq;
    stack.push({ id, close: () => ref.current() });
    return () => {
      const i = stack.findIndex((e) => e.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
