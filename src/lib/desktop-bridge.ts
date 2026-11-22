"use client";

type TauriGlobal = {
  __TAURI__?: {
    core?: {
      invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
};

function getInvoker() {
  if (typeof window === "undefined") return null;
  const g = window as unknown as TauriGlobal;
  return g.__TAURI__?.core?.invoke ?? g.__TAURI_INTERNALS__?.invoke ?? null;
}

export function isDesktopApp(): boolean {
  return getInvoker() !== null;
}

export async function invokeDesktop<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const invoker = getInvoker();
  if (!invoker) return null;
  try {
    return await invoker<T>(cmd, args);
  } catch {
    return null;
  }
}

export function setDesktopUnreadBadge(count: number) {
  if (!isDesktopApp()) return;
  void invokeDesktop("set_unread_badge", { count: Math.max(0, Math.floor(count)) });
}

export async function showDesktopAppNotification(title: string, body: string): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const res = await invokeDesktop("show_native_notification", {
    title,
    body: body.slice(0, 140),
  });
  return res !== null;
}

export function focusDesktopWindow() {
  if (!isDesktopApp()) return;
  void invokeDesktop("focus_main_window");
}
