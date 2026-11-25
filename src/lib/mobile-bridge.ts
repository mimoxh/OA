"use client";

import { useSyncExternalStore } from "react";

/** 手机 App（Capacitor 套壳）会在 WebView 中注入 window.Capacitor，并通过 OAShell 等原生插件提供壳层能力 */
type ListenerHandle = { remove: () => Promise<void> | void };
type CapPlugin = Record<string, ((args?: unknown) => Promise<unknown>) | undefined> & {
  addListener?: (event: string, cb: (data: unknown) => void) => Promise<ListenerHandle> | ListenerHandle;
};
type CapacitorGlobal = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: Record<string, CapPlugin | undefined>;
  };
};

function plugins() {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as CapacitorGlobal).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins ?? null;
}

export function isMobileApp(): boolean {
  return !!plugins()?.OAShell;
}

const noopSubscribe = () => () => {};

/** 是否运行在手机 App 内（服务端渲染与首帧为 false，避免水合不一致） */
export function useIsMobileApp(): boolean {
  return useSyncExternalStore(noopSubscribe, isMobileApp, () => false);
}

async function call<T>(plugin: string, method: string, args?: Record<string, unknown>): Promise<T | null> {
  const fn = plugins()?.[plugin]?.[method];
  if (typeof fn !== "function") return null;
  try {
    return (await fn.call(plugins()![plugin], args)) as T;
  } catch {
    return null;
  }
}

export type MobileShellState = {
  serverUrl: string | null;
  activeServerUrl: string | null;
  recent: string[];
  keepAlive: boolean;
  appVersion: string;
  debug: boolean;
  release: string;
  sdkInt: number;
  manufacturer: string;
  model: string;
  webViewVersion?: string;
  notificationsEnabled: boolean;
  ignoringBatteryOptimizations: boolean;
  service?: { state?: string; lastError?: string | null };
};

export function getMobileShellState() {
  return call<MobileShellState>("OAShell", "getState");
}

/** 回到包内启动页（切换服务器） */
export function openMobileLauncher() {
  void call("OAShell", "openLauncher");
}

export function openMobileNotificationSettings() {
  void call("OAShell", "openNotificationSettings");
}

export function setMobileKeepAlive(enabled: boolean) {
  return call("OAShell", "setKeepAlive", { enabled });
}

export async function copyTextNative(text: string): Promise<boolean> {
  return (await call("OAShell", "copyText", { text })) !== null;
}

/** App 退到后台（等同按 Home 键），用于在根页面按返回键 */
export function minimizeMobileApp() {
  void call("App", "minimizeApp");
}

/**
 * 订阅 Android 返回键。注册后 Capacitor 不再执行默认的 WebView 后退，由回调全权处理。
 * 返回取消订阅函数。
 */
export function onMobileBackButton(cb: (canGoBack: boolean) => void): () => void {
  const app = plugins()?.App;
  if (!app?.addListener) return () => {};
  let handle: ListenerHandle | null = null;
  let cancelled = false;
  void Promise.resolve(app.addListener("backButton", (d) => cb(!!(d as { canGoBack?: boolean })?.canGoBack))).then((h) => {
    if (cancelled) void h.remove();
    else handle = h;
  });
  return () => {
    cancelled = true;
    if (handle) void handle.remove();
  };
}

/** 订阅 App 前后台切换（appStateChange） */
export function onMobileAppState(cb: (active: boolean) => void): () => void {
  const app = plugins()?.App;
  if (!app?.addListener) return () => {};
  let handle: ListenerHandle | null = null;
  let cancelled = false;
  void Promise.resolve(app.addListener("appStateChange", (d) => cb(!!(d as { isActive?: boolean })?.isActive))).then((h) => {
    if (cancelled) void h.remove();
    else handle = h;
  });
  return () => {
    cancelled = true;
    if (handle) void handle.remove();
  };
}
