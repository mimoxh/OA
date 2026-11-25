"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { installStaleActionGuard } from "@/lib/stale-action";
import { isMobileApp, minimizeMobileApp, onMobileBackButton } from "@/lib/mobile-bridge";
import { popBackHandler } from "./back-stack";
import { navigateBack, useTrackNavStack } from "./nav-stack";
import { isTabRoot } from "./use-mobile-layout";

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

/** 根布局挂载一次：Server Action 失效兜底，以及 App 内的 Android 返回键 */
export function AppRuntime() {
  const router = useRouter();
  useTrackNavStack();

  useEffect(() => installStaleActionGuard(), []);

  useEffect(() => {
    if (!isMobileApp()) return;
    return onMobileBackButton(() => {
      if (closeTopLayer()) return;
      if (popBackHandler()) return;
      const path = window.location.pathname;
      if (path === "/login" || isTabRoot(path)) {
        minimizeMobileApp();
        return;
      }
      navigateBack(router, path);
    });
  }, [router]);

  return null;
}
