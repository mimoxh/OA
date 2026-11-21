"use client";

import { useEffect, useRef, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

export type CollabStatus = "connecting" | "connected" | "disconnected";
export type Peer = { clientId: number; id: string; name: string; color: string };
type TokenInfo = { token: string; readOnly: boolean; url: string; user: { id: string; name: string; color: string } };

async function fetchToken(docId: string): Promise<TokenInfo> {
  const res = await fetch(`/api/collab-token?doc=${encodeURIComponent(docId)}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? "无法获取协同令牌"), { status: res.status });
  return data as TokenInfo;
}

/** 部署在局域网时，把配置里的 localhost 替换为当前访问的主机名 */
function resolveUrl(url: string) {
  try {
    const u = new URL(url);
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      u.hostname = location.hostname;
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function useCollab(docId: string, onStateless: (msg: Record<string, unknown>) => void) {
  const [session, setSession] = useState<{ provider: HocuspocusProvider; ydoc: Y.Doc; user: TokenInfo["user"] } | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [everSynced, setEverSynced] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [unsynced, setUnsynced] = useState(0);
  const statelessRef = useRef(onStateless);
  useEffect(() => {
    statelessRef.current = onStateless;
  });

  useEffect(() => {
    let cancelled = false;
    let provider: HocuspocusProvider | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const ydoc = new Y.Doc();

    const start = async () => {
      let info: TokenInfo;
      try {
        info = await fetchToken(docId);
      } catch (e) {
        if (cancelled) return;
        setStatus("disconnected");
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403) {
          setError((e as Error).message);
          return;
        }
        retry = setTimeout(start, 4000);
        return;
      }
      if (cancelled) return;
      setReadOnly(info.readOnly);
      provider = new HocuspocusProvider({
        url: resolveUrl(info.url),
        name: docId,
        document: ydoc,
        token: async () => (await fetchToken(docId)).token,
        onStatus: ({ status }) => setStatus(status as CollabStatus),
        onSynced: ({ state }) => {
          setSynced(state);
          if (state) setEverSynced(true);
        },
        onAuthenticated: ({ scope }) => {
          setError(null);
          setReadOnly(scope === "readonly");
        },
        onAuthenticationFailed: ({ reason }) => setError(reason || "协同服务鉴权失败"),
        onUnsyncedChanges: ({ number }) => setUnsynced(number),
        onAwarenessChange: ({ states }) => {
          const me = provider?.awareness?.clientID;
          const list: Peer[] = [];
          const seen = new Set<string>();
          for (const s of states) {
            const u = s.user as { id?: string; name?: string; color?: string } | undefined;
            if (!u?.name || s.clientId === me) continue;
            const key = u.id ?? String(s.clientId);
            if (seen.has(key)) continue;
            seen.add(key);
            list.push({ clientId: s.clientId, id: key, name: u.name, color: u.color ?? "#6b7280" });
          }
          setPeers(list);
        },
        onStateless: ({ payload }) => {
          try {
            statelessRef.current(JSON.parse(payload));
          } catch {}
        },
      });
      setSession({ provider, ydoc, user: info.user });
    };
    start();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      provider?.destroy();
      ydoc.destroy();
    };
  }, [docId]);

  const send = (msg: Record<string, unknown>) => {
    try {
      session?.provider.sendStateless(JSON.stringify(msg));
    } catch {
      // 未连接时丢弃实时通知
    }
  };

  return { session, status, synced, everSynced, readOnly, error, peers, unsynced, send };
}
