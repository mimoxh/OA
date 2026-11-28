"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { toast } from "sonner";
import { isMobileApp } from "./mobile-bridge";

const RELOAD_KEY = "oa:stale-action-reload";
/** 刷新后仍然报错（例如服务端正在滚动升级）时不再自动刷新，避免死循环 */
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * 服务端升级后，打开着的旧页面里的 Server Action ID 在新版本中不存在，
 * Next 会抛 UnrecognizedActionError（“Server Action … was not found on the server”）。
 */
export function isStaleActionError(e: unknown): boolean {
  if (unstable_isUnrecognizedActionError(e)) return true;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /Server Action ".*" was not found on the server|failed-to-find-server-action/.test(msg);
}

function recentlyReloaded() {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    return Date.now() - at < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

let handled = false;

/** 手机 App：提示后自动刷新；浏览器：提示并提供“刷新”按钮（避免丢失用户正在编辑的内容） */
export function handleStaleAction() {
  if (handled) return;
  handled = true;
  if (isMobileApp() && !recentlyReloaded()) {
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {}
    toast.info("服务已更新，正在刷新页面…", { id: "stale-action" });
    setTimeout(() => window.location.reload(), 800);
    return;
  }
  toast("服务已更新，请刷新页面后重试", {
    id: "stale-action",
    duration: Infinity,
    action: { label: "刷新", onClick: () => window.location.reload() },
    onDismiss: () => {
      handled = false;
    },
  });
}

/** 未被调用方捕获的 Server Action 错误（如 void someAction()）兜底处理 */
export function installStaleActionGuard(): () => void {
  const onRejection = (ev: PromiseRejectionEvent) => {
    if (!isStaleActionError(ev.reason)) return;
    ev.preventDefault();
    handleStaleAction();
  };
  const onError = (ev: ErrorEvent) => {
    if (!isStaleActionError(ev.error ?? ev.message)) return;
    ev.preventDefault();
    handleStaleAction();
  };
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
  };
}
