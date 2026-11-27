"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { installStaleActionGuard } from "@/lib/stale-action";
import { isMobileApp, onMobileBackButton } from "@/lib/mobile-bridge";
import { popBackHandler } from "./back-stack";
import { navigateBack, useTrackNavStack } from "./nav-stack";

/** Radix 弹窗、菜单、下拉等浮层：返回键先关闭它们（与按 Esc 等价） */
function closeTopLayer(): boolean {
  const open = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]',
  );
  if (!open) return false;
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  return true;
}

function NavStackTracker() {
  useTrackNavStack();
  return null;
}

/** 根布局挂载一次：Server Action 失效兜底，以及 App 内的 Android 返回键 */
export function AppRuntime() {
  const router = useRouter();

  useEffect(() => installStaleActionGuard(), []);

  useEffect(() => {
    if (!isMobileApp()) return;
    // 返回键顺序：浮层 → 页面内全屏层 → 退到上一级页面（一级页面 / 登录页退到后台）
    return onMobileBackButton(() => {
      if (closeTopLayer()) return;
      if (popBackHandler()) return;
      navigateBack(router);
    });
  }, [router]);

  return (
    <Suspense fallback={null}>
      <NavStackTracker />
    </Suspense>
  );
}
