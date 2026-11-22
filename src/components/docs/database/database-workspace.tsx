"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpDown,
  Calendar,
  Columns3,
  Copy,
  Download,
  Filter,
  History,
  Kanban,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import {
  activeProperties,
  evaluateView,
  isCalendarProperty,
  isGroupableProperty,
  makeId,
} from "@/lib/docs/database/engine";
import {
  DATABASE_VIEW_TYPES,
  VIEW_TYPE_LABEL,
  flatFilters,
  type AggregateFunction,
  type DatabasePayload,
  type DatabaseRow,
  type DatabaseView,
  type DatabaseViewType,
  type PropertyDefinition,
  type PropertyValue,
} from "@/lib/docs/database/types";
import { CsvImportDialog, downloadDatabaseCsv } from "./csv-dialogs";
import { PropertyEditorDialog } from "./property-dialogs";
import { RowDrawer } from "./row-drawer";
import { SchemaHistoryDialog } from "./schema-history-dialog";
import { FieldsPanel, FilterPanel, SortPanel } from "./toolbar-panels";
import { BoardView } from "./views/board-view";
import { CalendarView } from "./views/calendar-view";
import { GalleryView } from "./views/gallery-view";
import { TableView } from "./views/table-view";

function ViewTypeIcon({ type, className = "size-3.5" }: { type: DatabaseViewType; className?: string }) {
  switch (type) {
    case "table":
      return <Table2 className={className} />;
    case "board":
      return <Kanban className={className} />;
    case "calendar":
      return <Calendar className={className} />;
    case "gallery":
      return <LayoutGrid className={className} />;
  }
}

export function DatabaseWorkspace({
  databaseId,
  initialData,
  initialViewId,
  compact = false,
  onActiveViewChange,
}: {
  databaseId: string;
  initialData?: DatabasePayload;
  initialViewId?: string | null;
  compact?: boolean;
  onActiveViewChange?: (viewId: string) => void;
}) {
  const [data, setData] = useState<DatabasePayload | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string>(
    initialViewId ?? initialData?.views[0]?.id ?? "",
  );
  const [search, setSearch] = useState("");
  const [openPopover, setOpenPopover] = useState<"filter" | "sort" | "fields" | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [drawerRowId, setDrawerRowId] = useState<string | null>(null);
  const [propDialog, setPropDialog] = useState<{ open: boolean; editing: PropertyDefinition | null }>({
    open: false,
    editing: null,
  });
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/databases/${databaseId}`, { cache: "no-store" });
      const json = (await res.json()) as DatabasePayload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "加载多维表格失败");
      setData(json);
      setLoadError(null);
      setActiveViewId((prev) =>
        prev && json.views.some((v) => v.id === prev) ? prev : (json.views[0]?.id ?? ""),
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    fetch(`/api/docs/databases/${databaseId}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as DatabasePayload & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "无法加载多维表格");
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setLoadError(null);
        setActiveViewId((prev) =>
          prev && json.views.some((v) => v.id === prev) ? prev : (json.views[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "无法加载多维表格");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [databaseId, initialData]);

  const activeView = useMemo(() => {
    if (!data) return null;
    return data.views.find((v) => v.id === activeViewId) ?? data.views[0] ?? null;
  }, [data, activeViewId]);

  const membersById = useMemo(
    () => new Map((data?.members ?? []).map((m) => [m.id, m])),
    [data?.members],
  );

  const visibleRows = useMemo(() => {
    if (!data || !activeView) return [];
    return evaluateView(data.rows, data.properties, activeView, { search, membersById });
  }, [data, activeView, search, membersById]);

  const drawerRow = useMemo(
    () => (drawerRowId && data ? (data.rows.find((r) => r.id === drawerRowId) ?? null) : null),
    [drawerRowId, data],
  );

  const persistSchema = useCallback(
    async (nextProps: PropertyDefinition[], nextViews: DatabaseView[]) => {
      if (!data) return null;
      const res = await fetch(`/api/docs/databases/${databaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: nextProps,
          views: nextViews,
          expectedRevision: data.revision,
        }),
      });
      const json = (await res.json()) as {
        revision?: number;
        properties?: PropertyDefinition[];
        views?: DatabaseView[];
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 409) {
          toast.error(json.error ?? "结构冲突，已自动刷新");
          await reload();
        } else {
          toast.error(json.error ?? "保存结构失败");
        }
        throw new Error(json.error ?? "保存结构失败");
      }
      // Reload full payload when formulas/rollups exist so computed values update immediately
      const hasComputed = (json.properties ?? nextProps).some(
        (p) => !p.deletedAt && (p.type === "formula" || p.type === "rollup"),
      );
      if (hasComputed) {
        await reload();
      } else {
        setData((prev) =>
          prev
            ? {
                ...prev,
                revision: json.revision ?? prev.revision + 1,
                properties: json.properties ?? nextProps,
                views: json.views ?? nextViews,
              }
            : prev,
        );
      }
      return json.properties ?? nextProps;
    },
    [data, databaseId, reload],
  );

  const updateActiveView = useCallback(
    (updater: (v: DatabaseView) => DatabaseView) => {
      if (!data || !activeView) return;
      const nextViews = data.views.map((v) => (v.id === activeView.id ? updater(v) : v));
      // Optimistically update local view state for smooth UX
      setData((prev) => (prev ? { ...prev, views: nextViews } : prev));
      if (data.canWrite) {
        void persistSchema(data.properties, nextViews).catch(() => {});
      }
    },
    [data, activeView, persistSchema],
  );

  const handleSelectView = (vid: string) => {
    setActiveViewId(vid);
    onActiveViewChange?.(vid);
  };

  const handleCreateView = async (type: DatabaseViewType) => {
    if (!data || !data.canWrite) return;
    const activeProps = activeProperties(data.properties);
    const groupProp = activeProps.find((p) => isGroupableProperty(p));
    const dateProp = activeProps.find((p) => isCalendarProperty(p));
    const newView: DatabaseView = {
      id: makeId("view"),
      name: `${VIEW_TYPE_LABEL[type]}视图`,
      type,
      ...(type === "board" && groupProp ? { groupPropertyId: groupProp.id } : {}),
      ...(type === "calendar" && dateProp ? { datePropertyId: dateProp.id } : {}),
      filters: [],
      sorts: [],
      hiddenPropertyIds: [],
      propertyOrder: activeProps.filter((p) => p.type !== "title").map((p) => p.id),
      widths: {},
    };
    const nextViews = [...data.views, newView];
    try {
      await persistSchema(data.properties, nextViews);
      handleSelectView(newView.id);
    } catch {}
  };

  const handleRenameView = async (v: DatabaseView) => {
    if (!data || !data.canWrite) return;
    const next = window.prompt("重命名视图", v.name)?.trim();
    if (!next || next === v.name) return;
    await persistSchema(
      data.properties,
      data.views.map((x) => (x.id === v.id ? { ...x, name: next } : x)),
    ).catch(() => {});
  };

  const handleDeleteView = async (viewId: string) => {
    if (!data || !data.canWrite || data.views.length <= 1) return;
    const nextViews = data.views.filter((v) => v.id !== viewId);
    try {
      await persistSchema(data.properties, nextViews);
      if (activeViewId === viewId) handleSelectView(nextViews[0].id);
    } catch {}
  };

  const handleCreateRow = async (initialProps?: Record<string, PropertyValue | null>) => {
    if (!data || !data.canWrite) return;
    try {
      const res = await fetch(`/api/docs/databases/${databaseId}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", properties: initialProps ?? {} }),
      });
      const json = (await res.json()) as { row?: DatabaseRow; error?: string };
      if (!res.ok || !json.row) throw new Error(json.error ?? "新建记录失败");
      setData((prev) => (prev ? { ...prev, rows: [...prev.rows, json.row!] } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "新建记录失败");
    }
  };

  const handleUpdateRow = async (
    rowId: string,
    payload: { title?: string; properties?: Record<string, PropertyValue | null> },
  ) => {
    if (!data || !data.canWrite) return;
    try {
      const res = await fetch(`/api/docs/databases/${databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { row?: DatabaseRow; error?: string };
      if (!res.ok || !json.row) throw new Error(json.error ?? "更新记录失败");
      setData((prev) =>
        prev ? { ...prev, rows: prev.rows.map((r) => (r.id === rowId ? json.row! : r)) } : prev,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新记录失败");
    }
  };

  const handleUpdateRelation = async (
    rowId: string,
    propertyId: string,
    add: string[],
    remove: string[],
  ) => {
    if (!data || !data.canWrite) return;
    try {
      const res = await fetch(
        `/api/docs/databases/${databaseId}/rows/${rowId}/relations/${propertyId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ add, remove }),
        },
      );
      const json = (await res.json()) as { row?: DatabaseRow; error?: string };
      if (!res.ok || !json.row) throw new Error(json.error ?? "更新关联失败");
      // Reload when rollups exist or self-relation exists so inverse cells update cleanly
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新关联失败");
    }
  };

  const handleDeleteRows = async (rowIds: string[]) => {
    if (!data || !data.canWrite || rowIds.length === 0) return;
    try {
      const res = await fetch(`/api/docs/databases/${databaseId}/rows/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", rowIds }),
      });
      const json = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "删除失败");
      const removed = new Set(rowIds);
      setData((prev) => (prev ? { ...prev, rows: prev.rows.filter((r) => !removed.has(r.id)) } : prev));
      setSelectedIds(new Set());
      toast.success(`已将 ${json.deleted ?? rowIds.length} 条记录移入回收站`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleDuplicateRows = async (rowIds: string[]) => {
    if (!data || !data.canWrite || rowIds.length === 0) return;
    try {
      const res = await fetch(`/api/docs/databases/${databaseId}/rows/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate", rowIds }),
      });
      const json = (await res.json()) as { createdIds?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "复制失败");
      setSelectedIds(new Set());
      toast.success(`已复制 ${json.createdIds?.length ?? rowIds.length} 条记录`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "复制失败");
    }
  };

  const handleReorderRows = async (orderedRowIds: string[]) => {
    if (!data || !data.canWrite) return;
    const orderMap = new Map(orderedRowIds.map((id, idx) => [id, idx]));
    setData((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              orderMap.has(r.id) ? { ...r, sortOrder: orderMap.get(r.id)! } : r,
            ),
          }
        : prev,
    );
    await fetch(`/api/docs/databases/${databaseId}/rows/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", orderedRowIds }),
    }).catch(() => {});
  };

  const handleSaveProperty = async (prop: PropertyDefinition, isNew: boolean) => {
    if (!data) return;
    const nextProps = isNew
      ? [...data.properties, prop]
      : data.properties.map((p) => (p.id === prop.id ? prop : p));
    const nextViews = isNew
      ? data.views.map((v) => ({ ...v, propertyOrder: [...v.propertyOrder, prop.id] }))
      : data.views;
    await persistSchema(nextProps, nextViews);
    toast.success(isNew ? `已添加字段「${prop.name}」` : `已更新字段「${prop.name}」`);
  };

  const handleCreateRelation = async (targetDatabaseId: string, name: string, pairedName: string) => {
    const res = await fetch(`/api/docs/databases/${databaseId}/relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetDatabaseId, name, pairedName }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "创建关联失败");
    toast.success(`已建立双向关联「${name}」`);
    await reload();
  };

  const handleSoftDeleteProperty = async (propId: string) => {
    if (!data || !data.canWrite) return;
    const now = new Date().toISOString();
    const nextProps = data.properties.map((p) => (p.id === propId ? { ...p, deletedAt: now } : p));
    await persistSchema(nextProps, data.views).catch(() => {});
    toast.success("字段已移入已删除列表（可在「字段」面板恢复）");
  };

  const handleRestoreProperty = async (propId: string) => {
    if (!data || !data.canWrite) return;
    const nextProps = data.properties.map((p) => (p.id === propId ? { ...p, deletedAt: null } : p));
    await persistSchema(nextProps, data.views).catch(() => {});
    toast.success("已恢复字段");
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-line bg-sidebar/30 p-8 text-center text-xs text-ink-3">
        正在加载多维表格…
      </div>
    );
  }
  if (loadError || !data || !activeView) {
    return (
      <div className="rounded-lg border border-line bg-sidebar/30 p-6 text-center text-xs text-ink-3">
        {loadError ?? "多维表格不存在或无访问权限"}
      </div>
    );
  }

  const filterCount = flatFilters(activeView.filters).length;
  const sortCount = activeView.sorts.length;
  const groupableProps = data.properties.filter((p) => isGroupableProperty(p));
  const calendarProps = data.properties.filter((p) => isCalendarProperty(p));

  return (
    <div className="space-y-2.5">
      {/* View Tabs + Primary Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex flex-wrap items-center gap-1">
          {data.views.map((v) => {
            const active = v.id === activeView.id;
            return (
              <div key={v.id} className="group/tab flex items-center">
                <button
                  type="button"
                  onClick={() => handleSelectView(v.id)}
                  onDoubleClick={() => data.canWrite && void handleRenameView(v)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                    active ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                  )}
                >
                  <ViewTypeIcon type={v.type} className="size-3.5" />
                  <span>{v.name}</span>
                </button>
                {data.canWrite && data.views.length > 1 && active && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteView(v.id)}
                    className="ml-0.5 flex size-5 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-rose-600"
                    title="删除此视图"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
          {data.canWrite && (
            <Menu>
              <MenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-3 hover:bg-hover hover:text-ink"
                  title="新建视图"
                >
                  <Plus className="size-3.5" />
                  视图
                </button>
              </MenuTrigger>
              <MenuContent className="w-36">
                {DATABASE_VIEW_TYPES.map((vt) => (
                  <MenuItem key={vt} icon={<ViewTypeIcon type={vt} />} onSelect={() => void handleCreateView(vt)}>
                    {VIEW_TYPE_LABEL[vt]}视图
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>

        {/* Right Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Board group selector */}
          {activeView.type === "board" && groupableProps.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-ink-3">
              <span>分组：</span>
              <select
                disabled={!data.canWrite}
                value={activeView.groupPropertyId ?? groupableProps[0].id}
                onChange={(e) => updateActiveView((v) => ({ ...v, groupPropertyId: e.target.value }))}
                className="h-7 rounded border border-line bg-white px-1.5 text-xs text-ink"
              >
                {groupableProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Calendar date field selector */}
          {activeView.type === "calendar" && calendarProps.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-ink-3">
              <span>日期：</span>
              <select
                disabled={!data.canWrite}
                value={activeView.datePropertyId ?? calendarProps[0].id}
                onChange={(e) => updateActiveView((v) => ({ ...v, datePropertyId: e.target.value }))}
                className="h-7 rounded border border-line bg-white px-1.5 text-xs text-ink"
              >
                {calendarProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Search box */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索记录..."
              className="h-7 w-32 rounded-md border border-line bg-white pl-7 pr-2 text-xs text-ink outline-none focus:w-44 focus:border-accent"
            />
          </div>

          {/* Filter popover */}
          <ToolbarPopover
            open={openPopover === "filter"}
            onToggle={() => setOpenPopover((p) => (p === "filter" ? null : "filter"))}
            active={filterCount > 0}
            icon={<Filter className="size-3.5" />}
            label={filterCount > 0 ? `筛选 (${filterCount})` : "筛选"}
          >
            <FilterPanel
              properties={data.properties}
              view={activeView}
              members={data.members}
              onChange={(filters) => updateActiveView((v) => ({ ...v, filters }))}
            />
          </ToolbarPopover>

          {/* Sort popover */}
          <ToolbarPopover
            open={openPopover === "sort"}
            onToggle={() => setOpenPopover((p) => (p === "sort" ? null : "sort"))}
            active={sortCount > 0}
            icon={<ArrowUpDown className="size-3.5" />}
            label={sortCount > 0 ? `排序 (${sortCount})` : "排序"}
          >
            <SortPanel
              properties={data.properties}
              view={activeView}
              onChange={(sorts) => updateActiveView((v) => ({ ...v, sorts }))}
            />
          </ToolbarPopover>

          {/* Fields popover */}
          <ToolbarPopover
            open={openPopover === "fields"}
            onToggle={() => setOpenPopover((p) => (p === "fields" ? null : "fields"))}
            active={activeView.hiddenPropertyIds.length > 0}
            icon={<Columns3 className="size-3.5" />}
            label="字段"
          >
            <FieldsPanel
              properties={data.properties}
              view={activeView}
              canWrite={data.canWrite}
              onToggleHidden={(propId) =>
                updateActiveView((v) => ({
                  ...v,
                  hiddenPropertyIds: v.hiddenPropertyIds.includes(propId)
                    ? v.hiddenPropertyIds.filter((id) => id !== propId)
                    : [...v.hiddenPropertyIds, propId],
                }))
              }
              onMoveOrder={(propId, dir) => {
                const activeNonTitle = activeProperties(data.properties)
                  .filter((p) => p.type !== "title")
                  .map((p) => p.id);
                const curOrder = [
                  ...activeView.propertyOrder.filter((id) => activeNonTitle.includes(id)),
                  ...activeNonTitle.filter((id) => !activeView.propertyOrder.includes(id)),
                ];
                const idx = curOrder.indexOf(propId);
                const swapIdx = idx + dir;
                if (idx < 0 || swapIdx < 0 || swapIdx >= curOrder.length) return;
                [curOrder[idx], curOrder[swapIdx]] = [curOrder[swapIdx], curOrder[idx]];
                updateActiveView((v) => ({ ...v, propertyOrder: curOrder }));
              }}
              onRestoreProperty={(propId) => void handleRestoreProperty(propId)}
              onAddProperty={() => {
                setOpenPopover(null);
                setPropDialog({ open: true, editing: null });
              }}
            />
          </ToolbarPopover>

          {!compact && (
            <>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-white px-2 text-xs text-ink-2 hover:bg-hover hover:text-ink"
                title="结构变更历史"
              >
                <History className="size-3.5" />
                历史
              </button>

              <Menu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-white px-2 text-xs text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <Download className="size-3.5" />
                    数据
                  </button>
                </MenuTrigger>
                <MenuContent className="w-40">
                  <MenuItem
                    icon={<Download />}
                    onSelect={() => downloadDatabaseCsv(data.title, data.properties, visibleRows, data.members)}
                  >
                    导出当前视图 CSV
                  </MenuItem>
                  <MenuItem
                    icon={<Download />}
                    onSelect={() => downloadDatabaseCsv(data.title, data.properties, data.rows, data.members)}
                  >
                    导出全部记录 CSV
                  </MenuItem>
                  {data.canWrite && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<Upload />} onSelect={() => setCsvImportOpen(true)}>
                        从 CSV 导入…
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            </>
          )}

          <button
            type="button"
            onClick={() => void reload()}
            className="flex size-7 items-center justify-center rounded-md border border-line bg-white text-ink-3 hover:bg-hover hover:text-ink"
            title="刷新数据"
          >
            <RefreshCw className="size-3.5" />
          </button>

          {data.canWrite && (
            <Button size="sm" variant="primary" onClick={() => void handleCreateRow()}>
              <Plus className="size-3.5" />
              新建
            </Button>
          )}
        </div>
      </div>

      {/* Bulk Selection Bar */}
      {data.canWrite && selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-1.5 text-xs">
          <span className="font-medium text-accent">已选中 {selectedIds.size} 条记录</span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="default" onClick={() => void handleDuplicateRows([...selectedIds])}>
              <Copy className="size-3.5" />
              复制所选
            </Button>
            <Button size="sm" variant="danger" onClick={() => void handleDeleteRows([...selectedIds])}>
              <Trash2 className="size-3.5" />
              删除所选
            </Button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded px-2 py-1 text-ink-2 hover:bg-white/60"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      {/* Active View Body */}
      {activeView.type === "table" && (
        <TableView
          properties={data.properties}
          view={activeView}
          rows={visibleRows}
          members={data.members}
          relatedDatabases={data.relatedDatabases}
          canWrite={data.canWrite}
          selectedIds={selectedIds}
          onToggleSelect={(id) =>
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleSelectAll={() =>
            setSelectedIds((prev) =>
              visibleRows.length > 0 && visibleRows.every((r) => prev.has(r.id))
                ? new Set()
                : new Set(visibleRows.map((r) => r.id)),
            )
          }
          onOpenRow={(id) => setDrawerRowId(id)}
          onCreateRow={() => void handleCreateRow()}
          onUpdateTitle={(id, title) => void handleUpdateRow(id, { title })}
          onUpdateProperty={(id, propId, val) => void handleUpdateRow(id, { properties: { [propId]: val } })}
          onUpdateRelation={(id, propId, add, rem) => void handleUpdateRelation(id, propId, add, rem)}
          onReorderRows={(ids) => void handleReorderRows(ids)}
          onAddProperty={() => setPropDialog({ open: true, editing: null })}
          onEditProperty={(p) => setPropDialog({ open: true, editing: p })}
          onDeleteProperty={(propId) => void handleSoftDeleteProperty(propId)}
          onHideProperty={(propId) =>
            updateActiveView((v) => ({
              ...v,
              hiddenPropertyIds: v.hiddenPropertyIds.includes(propId)
                ? v.hiddenPropertyIds
                : [...v.hiddenPropertyIds, propId],
            }))
          }
          onSortProperty={(propId, direction) =>
            updateActiveView((v) => ({
              ...v,
              sorts: [{ propertyId: propId, direction }, ...v.sorts.filter((s) => s.propertyId !== propId)],
            }))
          }
          onResizeColumn={(propId, width) =>
            updateActiveView((v) => ({ ...v, widths: { ...v.widths, [propId]: width } }))
          }
          onChangeAggregate={(propId, fn: AggregateFunction | null) =>
            updateActiveView((v) => {
              const next = { ...(v.aggregates ?? {}) };
              if (fn) next[propId] = fn;
              else delete next[propId];
              return { ...v, aggregates: next };
            })
          }
        />
      )}

      {activeView.type === "board" && (
        <BoardView
          properties={data.properties}
          view={activeView}
          rows={visibleRows}
          members={data.members}
          relatedDatabases={data.relatedDatabases}
          canWrite={data.canWrite}
          onOpenRow={(id) => setDrawerRowId(id)}
          onCreateRowWithProps={(props) => void handleCreateRow(props)}
          onUpdateProperty={(id, propId, val) => void handleUpdateRow(id, { properties: { [propId]: val } })}
          onUpdateRelation={(id, propId, add, rem) => void handleUpdateRelation(id, propId, add, rem)}
        />
      )}

      {activeView.type === "calendar" && (
        <CalendarView
          properties={data.properties}
          view={activeView}
          rows={visibleRows}
          canWrite={data.canWrite}
          onOpenRow={(id) => setDrawerRowId(id)}
          onCreateRowWithProps={(props) => void handleCreateRow(props)}
        />
      )}

      {activeView.type === "gallery" && (
        <GalleryView
          properties={data.properties}
          view={activeView}
          rows={visibleRows}
          members={data.members}
          relatedDatabases={data.relatedDatabases}
          canWrite={data.canWrite}
          onOpenRow={(id) => setDrawerRowId(id)}
          onCreateRow={() => void handleCreateRow()}
          onUpdateProperty={(id, propId, val) => void handleUpdateRow(id, { properties: { [propId]: val } })}
          onUpdateRelation={(id, propId, add, rem) => void handleUpdateRelation(id, propId, add, rem)}
        />
      )}

      {/* Slide-over Row Detail Drawer */}
      <RowDrawer
        row={drawerRow}
        properties={data.properties}
        members={data.members}
        relatedDatabases={data.relatedDatabases}
        canWrite={data.canWrite}
        onClose={() => setDrawerRowId(null)}
        onUpdateTitle={(id, title) => void handleUpdateRow(id, { title })}
        onUpdateProperty={(id, propId, val) => void handleUpdateRow(id, { properties: { [propId]: val } })}
        onUpdateRelation={(id, propId, add, rem) => void handleUpdateRelation(id, propId, add, rem)}
        onDeleteRow={(id) => void handleDeleteRows([id])}
      />

      {/* Property Add / Edit Dialog */}
      {propDialog.open && (
        <PropertyEditorDialog
          key={propDialog.editing?.id ?? "__new"}
          open={propDialog.open}
          onOpenChange={(v) => !v && setPropDialog({ open: false, editing: null })}
          databaseId={databaseId}
          properties={data.properties}
          editingProperty={propDialog.editing}
          relatedDatabases={data.relatedDatabases}
          onSaveProperty={handleSaveProperty}
          onCreateRelation={handleCreateRelation}
        />
      )}

      {/* CSV Import Dialog */}
      {csvImportOpen && (
        <CsvImportDialog
          open={csvImportOpen}
          onOpenChange={setCsvImportOpen}
          databaseId={databaseId}
          properties={data.properties}
          members={data.members}
          onAddNewProperties={async (newProps) => {
            const nextProps = [...data.properties, ...newProps];
            const nextViews = data.views.map((v) => ({
              ...v,
              propertyOrder: [...v.propertyOrder, ...newProps.map((p) => p.id)],
            }));
            return (await persistSchema(nextProps, nextViews)) ?? nextProps;
          }}
          onImported={reload}
        />
      )}

      {/* Schema History Dialog */}
      {historyOpen && (
        <SchemaHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          databaseId={databaseId}
          currentRevision={data.revision}
          canWrite={data.canWrite}
          onRestored={reload}
        />
      )}
    </div>
  );
}

function ToolbarPopover({
  open,
  onToggle,
  active,
  icon,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  active: boolean;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors",
          active
            ? "border-accent/40 bg-accent-soft text-accent"
            : "border-line bg-white text-ink-2 hover:bg-hover hover:text-ink",
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="absolute right-0 top-full z-40 mt-1 rounded-lg border border-line bg-white shadow-xl">
            {children}
          </div>
        </>
      )}
    </div>
  );
}
