"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

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
  // 等待 token 期间可能已 stopRealtime（退出登录/切换用户）
  if (!connectedFor) return;
  const sock = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
  ws = sock;
  sock.onopen = () => {
    // 重试后首次成功同样可能丢事件，按重连处理
    const isReconnect = everConnected || attempt > 0;
    attempt = 0;
    setStatus("open");
    if (isReconnect) emit({ type: "reconnected" });
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
  if (reconnectTimer) return;
  const wait = Math.min(1000 * 2 ** attempt++, 30_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, wait);
}

function wake() {
  if (!connectedFor) return;
  if (document.visibilityState === "visible" && (!ws || ws.readyState === WebSocket.CLOSED)) {
    attempt = 0;
    void connect();
  }
}

/** 建立/保持当前用户的实时连接；切换用户时先断旧连新 */
export function startRealtime(meId: string) {
  if (typeof window === "undefined") return;
  if (!listenersRegistered) {
    listenersRegistered = true;
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
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
  stopPing();
  const sock = ws;
  ws = null;
  if (sock) {
    // 先摘回调再 close，避免 onclose 又安排重连
    sock.onopen = null;
    sock.onmessage = null;
    sock.onclose = null;
    sock.onerror = null;
    try {
      sock.close();
    } catch {}
  }
  attempt = 0;
  everConnected = false;
  setStatus("closed");
}

/** 全局实时连接（每标签页一条 WS）；挂载在 (app) 布局内，同时初始化 IM store */
export function RealtimeProvider({ meId, children }: { meId: string; children: ReactNode }) {
  useEffect(() => {
    // initIm 内部幂等
    import("@/components/im/store").then((m) => m.initIm(meId));
    startRealtime(meId);
    return subscribeRealtime((event) => {
      if (event.type === "notification.new") {
        window.dispatchEvent(new Event("notifications:changed"));
      }
    });
  }, [meId]);
  return <>{children}</>;
}
