"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Compass,
  ExternalLink,
  GitFork,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { GraphPayload } from "@/lib/docs/links";
import {
  buildGraphView,
  buildLegend,
  nodeTitle,
  type GraphColorMode,
  type GraphNeighborEntry,
} from "@/lib/docs/graph/model";
import { cn } from "@/lib/utils";
import { GraphCanvas, type GraphCanvasHandle } from "./graph-canvas";

export type GraphViewProps = {
  initialData?: GraphPayload;
  initialSpaceId?: string | null;
  initialFocusId?: string | null;
  initialLocal?: boolean;
  initialDepth?: 1 | 2 | 3;
  onNavigate?: (docId: string) => void;
};

export function GraphView({
  initialData,
  initialSpaceId = null,
  initialFocusId = null,
  initialLocal = false,
  initialDepth = 1,
  onNavigate,
}: GraphViewProps) {
  const router = useRouter();
  const canvasRef = useRef<GraphCanvasHandle>(null);

  const [data, setData] = useState<GraphPayload | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId);
  const [query, setQuery] = useState("");
  const [showOrphans, setShowOrphans] = useState(true);
  const [showTreeEdges, setShowTreeEdges] = useState(false);
  const [colorMode, setColorMode] = useState<GraphColorMode>("space");
  const [local, setLocal] = useState(initialLocal && !!initialFocusId);
  const [focusId, setFocusId] = useState<string | null>(initialFocusId);
  const [depth, setDepth] = useState<1 | 2 | 3>(initialDepth);
  const [selectedId, setSelectedId] = useState<string | null>(initialFocusId);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/docs/graph", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "加载关系图失败");
        return;
      }
      const payload = (await res.json()) as GraphPayload;
      setData(payload);
    } catch {
      setError("网络异常，无法加载关系图");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialData) return;
    const ctrl = new AbortController();
    fetch("/api/docs/graph", { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "加载关系图失败");
          return;
        }
        const payload = (await res.json()) as GraphPayload;
        setData(payload);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setError("网络异常，无法加载关系图");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [initialData]);

  const view = useMemo(() => {
    if (!data) return null;
    return buildGraphView(data, {
      spaceId,
      query,
      showOrphans,
      showTreeEdges,
      local: local && !!focusId,
      focusId,
      depth,
    });
  }, [data, spaceId, query, showOrphans, showTreeEdges, local, focusId, depth]);

  const legend = useMemo(() => (view ? buildLegend(view, colorMode) : []), [view, colorMode]);

  const openDoc = useCallback(
    (id: string) => {
      if (onNavigate) onNavigate(id);
      else router.push(`/docs/${id}`);
    },
    [onNavigate, router],
  );

  const selectedNode = useMemo(() => {
    if (!view || !selectedId) return null;
    const idx = view.index.get(selectedId);
    return idx !== undefined ? view.nodes[idx]! : null;
  }, [view, selectedId]);

  const outgoingList: GraphNeighborEntry[] = selectedNode && view ? (view.outgoing.get(selectedNode.id) ?? []) : [];
  const incomingList: GraphNeighborEntry[] = selectedNode && view ? (view.incoming.get(selectedNode.id) ?? []) : [];

  const handleToggleLocal = () => {
    if (local) {
      setLocal(false);
      return;
    }
    const target = focusId ?? selectedId ?? view?.nodes[0]?.id ?? null;
    if (!target) return;
    setFocusId(target);
    setSelectedId(target);
    setLocal(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sidebar/70 px-3 py-2 text-xs">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选标题…"
            className="h-7 w-40 rounded-md border border-line bg-white pl-7 pr-6 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1.5 text-ink-3 hover:text-ink"
              aria-label="清除搜索"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {data && data.spaces.length > 1 && (
          <select
            value={spaceId ?? ""}
            onChange={(e) => setSpaceId(e.target.value || null)}
            className="h-7 max-w-[160px] rounded-md border border-line bg-white px-2 text-xs text-ink outline-none focus:border-accent"
            aria-label="空间筛选"
          >
            <option value="">全部空间</option>
            {data.spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {s.name}
              </option>
            ))}
          </select>
        )}

        <select
          value={colorMode}
          onChange={(e) => setColorMode(e.target.value as GraphColorMode)}
          className="h-7 rounded-md border border-line bg-white px-2 text-xs text-ink outline-none focus:border-accent"
          aria-label="着色方式"
        >
          <option value="space">按空间着色</option>
          <option value="group">按顶层页面着色</option>
          <option value="none">统一中性色</option>
        </select>

        <button
          type="button"
          onClick={() => setShowOrphans((v) => !v)}
          className={cn(
            "h-7 rounded-md border px-2 transition-colors",
            showOrphans
              ? "border-accent/40 bg-accent-soft text-accent"
              : "border-line bg-white text-ink-2 hover:bg-hover",
          )}
        >
          孤立页
        </button>

        <button
          type="button"
          onClick={() => setShowTreeEdges((v) => !v)}
          className={cn(
            "h-7 rounded-md border px-2 transition-colors",
            showTreeEdges
              ? "border-accent/40 bg-accent-soft text-accent"
              : "border-line bg-white text-ink-2 hover:bg-hover",
          )}
        >
          父子层级
        </button>

        {(focusId || selectedId) && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleToggleLocal}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md border px-2 transition-colors",
                local
                  ? "border-accent/40 bg-accent-soft font-medium text-accent"
                  : "border-line bg-white text-ink-2 hover:bg-hover",
              )}
            >
              <Compass className="size-3.5" />
              局部视图
            </button>
            {local && (
              <div className="flex overflow-hidden rounded-md border border-line bg-white">
                {([1, 2, 3] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDepth(d)}
                    className={cn(
                      "h-7 px-2 text-[11px] transition-colors",
                      depth === d ? "bg-accent text-white" : "text-ink-2 hover:bg-hover",
                    )}
                  >
                    {d}跳
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => canvasRef.current?.zoomBy(1 / 1.25)}
            className="flex size-7 items-center justify-center rounded-md border border-line bg-white text-ink-2 hover:bg-hover hover:text-ink"
            title="缩小 (-)"
            aria-label="缩小"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => canvasRef.current?.zoomBy(1.25)}
            className="flex size-7 items-center justify-center rounded-md border border-line bg-white text-ink-2 hover:bg-hover hover:text-ink"
            title="放大 (+)"
            aria-label="放大"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => canvasRef.current?.fit()}
            className="flex size-7 items-center justify-center rounded-md border border-line bg-white text-ink-2 hover:bg-hover hover:text-ink"
            title="适配视图 (0)"
            aria-label="适配视图"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void fetchGraph()}
            disabled={loading}
            className="flex size-7 items-center justify-center rounded-md border border-line bg-white text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
            title="刷新数据"
            aria-label="刷新数据"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* 主画布 + 右侧详情栏 */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1 bg-canvas">
          {loading && !data ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3">
              <Loader2 className="size-4 animate-spin" />
              正在加载关系图…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-danger">{error}</p>
              <button
                type="button"
                onClick={() => void fetchGraph()}
                className="rounded-md border border-line bg-white px-3 py-1.5 text-xs text-ink hover:bg-hover"
              >
                重试
              </button>
            </div>
          ) : view && view.nodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-ink-3">
              <GitFork className="size-8 opacity-40" />
              <p className="text-sm font-medium text-ink-2">当前筛选条件下没有可显示的页面</p>
              <p className="max-w-sm text-xs">
                {!showOrphans
                  ? "试着开启「孤立页」或在文档正文中使用 [[ 建立页面双链。"
                  : "尝试清除搜索词或切换空间筛选。"}
              </p>
            </div>
          ) : view ? (
            <>
              <GraphCanvas
                ref={canvasRef}
                view={view}
                colorMode={colorMode}
                selectedId={selectedId}
                currentId={focusId}
                label="文档关系图"
                onSelect={setSelectedId}
                onOpen={openDoc}
              />

              {/* 左下角统计与图例 */}
              <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] flex-col items-start gap-1.5">
                {legend.length > 0 && (
                  <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-white/92 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-card backdrop-blur-xs">
                    {legend.map((item) => (
                      <span key={item.key} className="flex items-center gap-1.5">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="max-w-[120px] truncate">{item.label}</span>
                        <span className="text-ink-3">{item.count}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 rounded-md border border-line bg-white/90 px-2.5 py-1 text-[11px] text-ink-3 shadow-card backdrop-blur-xs">
                  <span>{view.nodes.length} 个页面</span>
                  <span>·</span>
                  <span>{view.linkEdgeCount} 条引用</span>
                  {data?.truncated && (
                    <>
                      <span>·</span>
                      <span className="text-tag-orange-ink">数据量较大，已按上限截断</span>
                    </>
                  )}
                  <span className="hidden sm:inline">· 双击节点打开页面</span>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* 右侧节点详情侧栏 */}
        {selectedNode && (
          <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-sidebar/50 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:bg-white max-md:shadow-pop">
            <div className="flex items-start justify-between gap-2 border-b border-line px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-lg leading-none">{selectedNode.icon || "📄"}</span>
                  <h3 className="truncate text-sm font-semibold text-ink">{nodeTitle(selectedNode)}</h3>
                </div>
                <div className="mt-1 text-[11px] text-ink-3">
                  {selectedNode.spaceIcon} {selectedNode.spaceName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                aria-label="关闭详情"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="flex gap-1.5 border-b border-line px-3.5 py-2.5">
              <button
                type="button"
                onClick={() => openDoc(selectedNode.id)}
                className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-white hover:bg-accent-hover"
              >
                <ExternalLink className="size-3.5" />
                打开页面
              </button>
              <button
                type="button"
                onClick={() => {
                  setFocusId(selectedNode.id);
                  setLocal(true);
                }}
                className="flex h-7 items-center justify-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
                title="以该页面为中心查看局部关系"
              >
                <Compass className="size-3.5" />
                局部中心
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3 text-xs">
              <div>
                <div className="mb-1.5 flex items-center gap-1 font-semibold text-ink-3">
                  <ArrowRight className="size-3.5" />
                  引用了 ({outgoingList.length})
                </div>
                {outgoingList.length === 0 ? (
                  <p className="text-ink-3">暂无出链</p>
                ) : (
                  <ul className="space-y-1">
                    {outgoingList.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          onDoubleClick={() => openDoc(item.id)}
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-hover"
                        >
                          <span className="shrink-0">{item.icon || "📄"}</span>
                          <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
                          {item.count > 1 && <span className="shrink-0 text-[11px] text-ink-3">×{item.count}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-1 font-semibold text-ink-3">
                  <ArrowLeft className="size-3.5" />
                  被引用 ({incomingList.length})
                </div>
                {incomingList.length === 0 ? (
                  <p className="text-ink-3">暂无反向链接</p>
                ) : (
                  <ul className="space-y-1">
                    {incomingList.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          onDoubleClick={() => openDoc(item.id)}
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-hover"
                        >
                          <span className="shrink-0">{item.icon || "📄"}</span>
                          <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
                          {item.count > 1 && <span className="shrink-0 text-[11px] text-ink-3">×{item.count}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
