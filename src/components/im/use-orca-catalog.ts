"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { OrcaCatalog } from "@/lib/im/orca-catalog-shared";

/**
 * Orca 基座 / 模型目录的客户端缓存：同一页面内所有选择器共享一次请求，5 分钟内不重复拉取；
 * 手动刷新时带 ?refresh=1 让服务端重新执行 Orca CLI 与读取模型目录。
 */
type State = { data: OrcaCatalog | null; loading: boolean; error: string | null; at: number };

const TTL_MS = 5 * 60_000;
let state: State = { data: null, loading: false, error: null, at: 0 };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function loadOrcaCatalog(refresh = false): Promise<void> {
  if (inflight && !refresh) return inflight;
  set({ loading: true, error: null });
  const p = fetch(`/api/im/webhooks/orca-catalog${refresh ? "?refresh=1" : ""}`, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) throw new Error(res.status === 401 ? "登录已过期" : `HTTP ${res.status}`);
      set({ data: (await res.json()) as OrcaCatalog, loading: false, at: Date.now() });
    })
    .catch((e: unknown) => {
      // 失败时保留已有数据，选择器继续使用静态预设
      set({ loading: false, error: e instanceof Error ? e.message : "加载失败" });
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;
// getServerSnapshot 必须返回稳定引用，否则 React 会判定为无限更新
const SERVER_STATE: State = { data: null, loading: false, error: null, at: 0 };
const serverSnapshot = () => SERVER_STATE;

export function useOrcaCatalog() {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (!state.loading && (!state.data || Date.now() - state.at > TTL_MS) && !state.error) void loadOrcaCatalog();
  }, []);
  const refresh = useCallback(() => loadOrcaCatalog(true), []);
  return { catalog: s.data, loading: s.loading, error: s.error, refresh };
}
