"use client";

import { useSyncExternalStore } from "react";

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

export type DesktopServerInfo = {
  status: "stopped" | "starting" | "running" | "error";
  port: number;
  lan: boolean;
  addresses: { name: string; url: string }[];
  error: string | null;
};

export type DesktopContext = {
  mode: "server" | "client" | null;
  serverUrl: string | null;
  server: DesktopServerInfo | null;
  version: string;
};

const noopSubscribe = () => () => {};

/** 是否运行在桌面客户端内（服务端渲染与首帧为 false，避免水合不一致） */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(noopSubscribe, isDesktopApp, () => false);
}

export function getDesktopContext() {
  return invokeDesktop<DesktopContext>("desktop_context");
}

export function windowAction(action: "minimize" | "toggle_maximize" | "close") {
  void invokeDesktop("window_action", { action });
}

export async function isWindowMaximized(): Promise<boolean> {
  return (await invokeDesktop<boolean>("window_is_maximized")) ?? false;
}

/** 回到桌面端内置的启动页：home 选择工作空间，settings 本机服务器设置 */
export function openLauncher(view: "home" | "settings") {
  void invokeDesktop("open_launcher", { view });
}

export function openDataDir() {
  void invokeDesktop("open_data_dir");
}
