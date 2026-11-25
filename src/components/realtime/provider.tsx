"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { isMobileApp } from "@/lib/mobile-bridge";

export type RealtimeEvent = { type: string } & Record<string, unknown>;
type Listener = (event: RealtimeEvent) => void;
export type RealtimeStatus = "connecting" | "open" | "closed";

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();

let ws: WebSocket | null = null;
let status: RealtimeStatus = "closed";
let connectedFor: string | null = null;
let listenersRegistered = false;
let everConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let attempt = 0;
// 手机 App 退到后台后由原生后台连接（?client=bg，不计入在线）接收提醒；页面这条连接一直挂着会让用户始终显示“在线”，
// 所以后台超过 PARK_MS 就断开（通话中除外），回到前台时重连并按 reconnected 补齐消息
const PARK_MS = 60_000;
let parked = false;
let parkTimer: ReturnType<typeof setTimeout> | null = null;
let parkGuard: (() => boolean) | null = null;

function emit(event: RealtimeEvent) {
  for (const l of [...listeners]) {
    try {
      l(event);
    } catch (e) {
      console.error("[realtime] listener 出错", e);
    }
  }
}

/** 订阅实时事件（组件外用 subscribeRealtime，组件内配合 useEffect） */
export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 客户端 → 实时服务（typing 等），未连接时静默丢弃 */
export function sendRealtime(obj: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function setStatus(s: RealtimeStatus) {
  if (s === status) return;
  status = s;
  for (const l of [...statusListeners]) l();
}

function subscribeStatus(l: () => void) {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeStatus, () => status, () => "closed" as RealtimeStatus);
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

async function connect() {
  if (!connectedFor) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setStatus("connecting");
  let url: string, token: string;
  try {
    const r = await fetch("/api/realtime-token", { cache: "no-store" });
    if (!r.ok) throw new Error(`realtime-token ${r.status}`);
    const j = (await r.json()) as { url: string; token: string };
    url = j.url;
    token = j.token;
  } catch {
    scheduleReconnect();
    return;
  }
  // 等待 token 期间可能已 stopRealtime（退出登录/切换用户）或 App 已退到后台
  if (!connectedFor || parked) return;
  // App 内页面标记为 client=app：服务端只给手机（App 页面与后台连接）发 push.* 事件
  const sock = new WebSocket(`${url}?token=${encodeURIComponent(token)}${isMobileApp() ? "&client=app" : ""}`);
  ws = sock;
  sock.onopen = () => {
    // 重试后首次成功同样可能丢事件，按重连处理
    const isReconnect = everConnected || attempt > 0;
    attempt = 0;
    setStatus("open");
    activityReported = null;
    reportActivity();
    emit({ type: isReconnect ? "reconnected" : "connected" });
    everConnected = true;
    stopPing();
    pingTimer = setInterval(() => sendRealtime({ type: "ping" }), 25_000);
  };
  sock.onmessage = (ev) => {
    try {
      emit(JSON.parse(String(ev.data)));
    } catch {}
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    stopPing();
    setStatus("closed");
    scheduleReconnect();
  };
  sock.onerror = () => {
    try {
      sock.close();
    } catch {}
  };
}

function scheduleReconnect() {
  setStatus("closed");
  if (reconnectTimer || parked) return;
  const wait = Math.min(1000 * 2 ** attempt++, 30_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, wait);
}

/** 通话等需要保持页面连接的模块登记：返回 true 时 App 退到后台也不断开 */
export function setRealtimeParkGuard(guard: (() => boolean) | null) {
  parkGuard = guard;
}

function closeSocket() {
  stopPing();
  const sock = ws;
  ws = null;
  if (!sock) return;
  // 先摘回调再 close，避免 onclose 又安排重连
  sock.onopen = null;
  sock.onmessage = null;
  sock.onclose = null;
  sock.onerror = null;
  try {
    sock.close();
  } catch {}
}

function park() {
  parkTimer = null;
  if (!connectedFor || document.visibilityState !== "hidden") return;
  if (parkGuard?.()) {
    parkTimer = setTimeout(park, PARK_MS);
    return;
  }
  parked = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  closeSocket();
  setStatus("closed");
}

function onVisibilityForPark() {
  if (!isMobileApp()) return;
  if (document.visibilityState === "hidden") {
    if (!parkTimer && !parked) parkTimer = setTimeout(park, PARK_MS);
    return;
  }
  if (parkTimer) clearTimeout(parkTimer);
  parkTimer = null;
}

function wake() {
  if (!connectedFor) return;
  if (document.visibilityState === "visible") parked = false;
  if (document.visibilityState === "visible" && (!ws || ws.readyState === WebSocket.CLOSED)) {
    attempt = 0;
    void connect();
  }
}

// ── 电脑端活跃状态上报 ──
// 页面可见、有焦点且最近有键鼠操作时告诉实时服务“正在电脑上使用”，服务端据此让手机端提醒静默（见 src/lib/push/realtime-filter.ts）。
// 服务端 3 分钟内没收到刷新即视为离开；这里每分钟刷新一次，空闲 2 分钟后主动上报离开。
const IDLE_MS = 2 * 60 * 1000;
const REFRESH_MS = 60 * 1000;
let lastInputAt = 0;
let activityReported: boolean | null = null;
let activitySentAt = 0;
let activityStarted = false;

function reportActivity() {
  if (typeof document === "undefined" || isMobileApp()) return;
  const now = Date.now();
  const active = document.visibilityState === "visible" && document.hasFocus() && now - lastInputAt < IDLE_MS;
  if (active === activityReported && !(active && now - activitySentAt > REFRESH_MS)) return;
  if (ws?.readyState !== WebSocket.OPEN) return;
  sendRealtime({ type: "activity", active });
  activityReported = active;
  activitySentAt = now;
}

function onUserInput() {
  lastInputAt = Date.now();
  if (activityReported !== true || lastInputAt - activitySentAt > REFRESH_MS) reportActivity();
}

function startActivityReporter() {
  if (activityStarted || isMobileApp()) return;
  activityStarted = true;
  lastInputAt = document.hasFocus() ? Date.now() : 0;
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(type, onUserInput, { passive: true, capture: true });
  }
  let lastMove = 0;
  window.addEventListener(
    "pointermove",
    () => {
      const now = Date.now();
      if (now - lastMove < 5000) return;
      lastMove = now;
      onUserInput();
    },
    { passive: true, capture: true },
  );
  window.addEventListener("focus", onUserInput);
  window.addEventListener("blur", reportActivity);
  document.addEventListener("visibilitychange", reportActivity);
  setInterval(reportActivity, 30_000);
}

/** 建立/保持当前用户的实时连接；切换用户时先断旧连新 */
export function startRealtime(meId: string) {
  if (typeof window === "undefined") return;
  if (!listenersRegistered) {
    listenersRegistered = true;
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisibilityForPark);
    document.addEventListener("visibilitychange", wake);
    startActivityReporter();
  }
  if (connectedFor === meId) return;
  if (connectedFor) stopRealtime();
  connectedFor = meId;
  void connect();
}

/** 断开连接并停止一切重连（退出登录/切换用户时调用） */
export function stopRealtime() {
  connectedFor = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (parkTimer) clearTimeout(parkTimer);
  parkTimer = null;
  parked = false;
  closeSocket();
  attempt = 0;
  everConnected = false;
  setStatus("closed");
}

/** 全局实时连接（每标签页一条 WS）；挂载在 (app) 布局内，同时初始化 IM store */
export function RealtimeProvider({ meId, children }: { meId: string; children: ReactNode }) {
  useEffect(() => {
    // initIm / initCallStore 内部幂等
    import("@/components/im/store").then((m) => m.initIm(meId));
    import("@/components/call/store").then((m) => m.initCallStore(meId));
    import("@/lib/im/desktop-notify").then((m) => void m.registerServiceWorker());
    startRealtime(meId);
    return subscribeRealtime((event) => {
      if (event.type === "notification.new") {
        window.dispatchEvent(new Event("notifications:changed"));
      }
    });
  }, [meId]);
  return <>{children}</>;
}
