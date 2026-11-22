"use client";

import { isDesktopApp, showDesktopAppNotification } from "@/lib/desktop-bridge";

const STORAGE_KEY = "oa_im_desktop_notify";
let swRegistered = false;
const listeners = new Set<() => void>();

function emitNotifyState() {
  for (const l of listeners) l();
}

export function subscribeDesktopNotify(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type NotifyPrefState = "unsupported" | "denied" | "off" | "on";

export function isDesktopNotifySupported(): boolean {
  return isDesktopApp() || (typeof window !== "undefined" && "Notification" in window);
}

export function getDesktopNotifyState(): NotifyPrefState {
  if (!isDesktopNotifySupported()) return "unsupported";
  if (isDesktopApp()) {
    return window.localStorage.getItem(STORAGE_KEY) === "off" ? "off" : "on";
  }
  if (Notification.permission === "denied") return "denied";
  const pref = window.localStorage.getItem(STORAGE_KEY);
  if (Notification.permission === "granted" && pref !== "off") return "on";
  return "off";
}

export async function toggleDesktopNotify(): Promise<NotifyPrefState> {
  if (!isDesktopNotifySupported()) return "unsupported";
  const cur = getDesktopNotifyState();
  if (cur === "on") {
    window.localStorage.setItem(STORAGE_KEY, "off");
    emitNotifyState();
    return "off";
  }
  if (isDesktopApp()) {
    window.localStorage.setItem(STORAGE_KEY, "on");
    emitNotifyState();
    return "on";
  }
  if (Notification.permission === "denied") {
    emitNotifyState();
    return "denied";
  }
  let perm: NotificationPermission = Notification.permission;
  if (perm === "default") {
    try {
      perm = await Notification.requestPermission();
    } catch {
      emitNotifyState();
      return "off";
    }
  }
  if (perm === "granted") {
    window.localStorage.setItem(STORAGE_KEY, "on");
    void registerServiceWorker();
    emitNotifyState();
    return "on";
  }
  emitNotifyState();
  return perm === "denied" ? "denied" : "off";
}

export async function registerServiceWorker() {
  if (swRegistered || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  swRegistered = true;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // 非 HTTPS 非 localhost 场景静默忽略
  }
}

export function showDesktopNotification(opts: { title: string; body: string; url: string; tag?: string }) {
  if (getDesktopNotifyState() !== "on") return;
  if (isDesktopApp()) {
    void showDesktopAppNotification(opts.title, opts.body);
    return;
  }
  try {
    const n = new Notification(opts.title, {
      body: opts.body.slice(0, 120),
      icon: "/icon.svg",
      tag: opts.tag,
    });
    n.onclick = () => {
      window.focus();
      if (window.location.pathname + window.location.search !== opts.url) {
        window.location.assign(opts.url);
      }
      n.close();
    };
  } catch {
    // 某些移动浏览器只允许通过 SW showNotification，降级走 SW
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready
        .then((reg) =>
          reg.showNotification(opts.title, {
            body: opts.body.slice(0, 120),
            icon: "/icon.svg",
            tag: opts.tag,
            data: { url: opts.url },
          }),
        )
        .catch(() => {});
    }
  }
}
