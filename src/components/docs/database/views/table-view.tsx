"use client";

import { useState, type DragEvent, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, EyeOff, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { aggregateColumn, aggregatesFor, viewColumns } from "@/lib/docs/database/engine";
import {
  AGGREGATE_FUNCTION_LABEL,
  DATABASE_LIMITS,
  effectiveType,
  type AggregateFunction,
  type DatabaseRow,
  type DatabaseView,
  type PersonOption,
  type PropertyDefinition,
  type PropertyValue,
  type TargetDatabaseSummary,
} from "@/lib/docs/database/types";
import { DatabaseCell, PropertyTypeIcon } from "../cells";

export function TableView({
  properties,
  view,
  rows,
  members,
  relatedDatabases,
  canWrite,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenRow,
  onCreateRow,
  onUpdateTitle,
  onUpdateProperty,
  onUpdateRelation,
  onReorderRows,
  onAddProperty,
  onEditProperty,
  onDeleteProperty,
  onHideProperty,
  onSortProperty,
  onResizeColumn,
  onChangeAggregate,
}: {
  properties: PropertyDefinition[];
  view: DatabaseView;
  rows: DatabaseRow[];
  members: PersonOption[];
  relatedDatabases: Record<string, TargetDatabaseSummary>;
  canWrite: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (rowId: string) => void;
  onToggleSelectAll: () => void;
  onOpenRow: (rowId: string) => void;
  onCreateRow: () => void;
  onUpdateTitle: (rowId: string, title: string) => void;
  onUpdateProperty: (rowId: string, propertyId: string, value: PropertyValue | null) => void;
  onUpdateRelation: (rowId: string, propertyId: string, add: string[], remove: string[]) => void;
  onReorderRows: (orderedIds: string[]) => void;
  onAddProperty: () => void;
  onEditProperty: (prop: PropertyDefinition) => void;
  onDeleteProperty: (propId: string) => void;
  onHideProperty: (propId: string) => void;
  onSortProperty: (propId: string, dir: "asc" | "desc") => void;
  onResizeColumn: (propId: string, width: number) => void;
  onChangeAggregate: (propId: string, fn: AggregateFunction | null) => void;
}) {
  const columns = viewColumns(properties, view);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [dropRowId, setDropRowId] = useState<string | null>(null);
  const [resizingWidth, setResizingWidth] = useState<Record<string, number>>({});
  const canDragReorder = canWrite && view.sorts.length === 0;
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  const getWidth = (col: PropertyDefinition) =>
    resizingWidth[col.id] ?? view.widths[col.id] ?? (col.type === "title" ? 240 : DATABASE_LIMITS.columnWidthDefault);

  const startResize = (e: MouseEvent, col: PropertyDefinition) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = getWidth(col);
    let latestW = startW;

    const onMove = (ev: globalThis.MouseEvent) => {
      latestW = Math.max(
        DATABASE_LIMITS.columnWidthMin,
        Math.min(DATABASE_LIMITS.columnWidthMax, Math.round(startW + ev.clientX - startX)),
      );
      setResizingWidth((prev) => ({ ...prev, [col.id]: latestW }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizingWidth((prev) => {
        const next = { ...prev };
        delete next[col.id];
        return next;
      });
      if (latestW !== startW) onResizeColumn(col.id, latestW);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleRowDrop = (e: DragEvent, targetRowId: string) => {
    e.preventDefault();
    const src = dragRowId;
    setDragRowId(null);
    setDropRowId(null);
    if (!src || src === targetRowId) return;
    const ids = rows.map((r) => r.id);
    const fromIdx = ids.indexOf(src);
    const toIdx = ids.indexOf(targetRowId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, src);
    onReorderRows(ids);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-max min-w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-sidebar/70 text-ink-2">
            {canWrite && (
              <th className="w-12 border-r border-line/70 px-2 py-2 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="全选"
                  className="size-3.5 cursor-pointer accent-accent"
                />
              </th>
            )}
            {columns.map((col) => {
              const w = getWidth(col);
              return (
                <th
                  key={col.id}
                  style={{ width: w, minWidth: w }}
                  className="group/th relative select-none border-r border-line/70 px-2.5 py-2 font-medium"
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <PropertyTypeIcon type={col.type} className="size-3.5 shrink-0 text-ink-3" />
                      <span className="truncate text-ink">{col.name}</span>
                    </div>
                    {canWrite && (
                      <Menu>
                        <MenuTrigger asChild>
                          <button
                            type="button"
                            className="flex size-5 shrink-0 items-center justify-center rounded text-ink-3 opacity-0 hover:bg-active hover:text-ink group-hover/th:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </MenuTrigger>
                        <MenuContent className="w-40">
                          <MenuItem icon={<Pencil />} onSelect={() => onEditProperty(col)}>
                            编辑字段
                          </MenuItem>
                          <MenuItem icon={<ArrowUp />} onSelect={() => onSortProperty(col.id, "asc")}>
                            升序排列
                          </MenuItem>
                          <MenuItem icon={<ArrowDown />} onSelect={() => onSortProperty(col.id, "desc")}>
                            降序排列
                          </MenuItem>
                          {col.type !== "title" && (
                            <>
                              <MenuItem icon={<EyeOff />} onSelect={() => onHideProperty(col.id)}>
                                隐藏列
                              </MenuItem>
                              <MenuSeparator />
                              <MenuItem icon={<Trash2 />} danger onSelect={() => onDeleteProperty(col.id)}>
                                删除字段
                              </MenuItem>
                            </>
                          )}
                        </MenuContent>
                      </Menu>
                    )}
                  </div>
                  {canWrite && (
                    <div
                      onMouseDown={(e) => startResize(e, col)}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-accent/40"
                    />
                  )}
                </th>
              );
            })}
            {canWrite && (
              <th className="w-24 px-2 py-1.5">
                <button
                  type="button"
                  onClick={onAddProperty}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-normal text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <Plus className="size-3.5" />
                  添加列
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (canWrite ? 2 : 0)} className="px-4 py-8 text-center text-xs text-ink-3">
                暂无匹配的记录
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                draggable={canDragReorder}
                onDragStart={() => setDragRowId(row.id)}
                onDragEnd={() => {
                  setDragRowId(null);
                  setDropRowId(null);
                }}
                onDragOver={(e) => {
                  if (!canDragReorder || !dragRowId || dragRowId === row.id) return;
                  e.preventDefault();
                  if (dropRowId !== row.id) setDropRowId(row.id);
                }}
                onDrop={(e) => canDragReorder && handleRowDrop(e, row.id)}
                className={cn(
                  "group/tr transition-colors hover:bg-hover/40",
                  selectedIds.has(row.id) && "bg-accent-soft/40",
                  dropRowId === row.id && "border-t-2 border-t-accent",
                )}
              >
                {canWrite && (
                  <td className="border-r border-line/60 px-1.5 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      {canDragReorder && (
                        <GripVertical className="size-3.5 cursor-grab text-ink-3 opacity-0 group-hover/tr:opacity-100" />
                      )}
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => onToggleSelect(row.id)}
                        className="size-3.5 cursor-pointer accent-accent"
                        aria-label="选择行"
                      />
                    </div>
                  </td>
                )}
                {columns.map((col) => {
                  const w = getWidth(col);
                  return (
                    <td
                      key={col.id}
                      style={{ width: w, maxWidth: w }}
                      className="border-r border-line/60 px-2.5 py-1.5 align-middle"
                    >
                      <DatabaseCell
                        row={row}
                        def={col}
                        members={members}
                        relatedDatabases={relatedDatabases}
                        canWrite={canWrite}
                        onUpdateTitle={(title) => onUpdateTitle(row.id, title)}
                        onUpdateProperty={(propId, val) => onUpdateProperty(row.id, propId, val)}
                        onUpdateRelation={(propId, add, rem) => onUpdateRelation(row.id, propId, add, rem)}
                        onOpenRow={onOpenRow}
                      />
                    </td>
                  );
                })}
                {canWrite && <td />}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          {canWrite && (
            <tr className="border-t border-line/80">
              <td colSpan={columns.length + 2} className="p-0">
                <button
                  type="button"
                  onClick={onCreateRow}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-ink-3 hover:bg-hover/60 hover:text-ink"
                >
                  <Plus className="size-3.5" />
                  新建记录
                </button>
              </td>
            </tr>
          )}
          <tr className="border-t border-line bg-sidebar/50 text-[11px] text-ink-3">
            {canWrite && <td className="border-r border-line/60 px-2 py-1.5 text-center">统计</td>}
            {columns.map((col) => {
              const fn = view.aggregates?.[col.id] ?? (col.type === "title" ? "count" : undefined);
              const val = fn ? aggregateColumn(rows, col, fn) : null;
              const allowed = aggregatesFor(effectiveType(col));
              return (
                <td key={col.id} className="border-r border-line/60 px-2.5 py-1">
                  <div className="flex items-center justify-between gap-1">
                    {canWrite ? (
                      <select
                        value={fn ?? ""}
                        onChange={(e) =>
                          onChangeAggregate(
                            col.id,
                            e.target.value ? (e.target.value as AggregateFunction) : null,
                          )
                        }
                        className="bg-transparent text-[11px] text-ink-3 outline-none hover:text-ink"
                      >
                        <option value="">统计…</option>
                        {allowed.map((a) => (
                          <option key={a} value={a}>
                            {AGGREGATE_FUNCTION_LABEL[a]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{fn ? AGGREGATE_FUNCTION_LABEL[fn] : ""}</span>
                    )}
                    {fn && (
                      <span className="font-mono font-medium text-ink">
                        {val === null ? "—" : typeof val === "number" ? val.toLocaleString("zh-CN") : val}
                      </span>
                    )}
                  </div>
                </td>
              );
            })}
            {canWrite && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
