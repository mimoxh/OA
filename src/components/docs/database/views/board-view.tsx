"use client";

import { useState, type DragEvent } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cellValue,
  groupMoveValue,
  groupRows,
  isGroupableProperty,
  viewColumns,
} from "@/lib/docs/database/engine";
import {
  OPTION_COLOR_STYLE,
  type DatabaseRow,
  type DatabaseView,
  type OptionColor,
  type PersonOption,
  type PropertyDefinition,
  type PropertyValue,
  type TargetDatabaseSummary,
} from "@/lib/docs/database/types";
import { DatabaseCell } from "../cells";

export function BoardView({
  properties,
  view,
  rows,
  members,
  relatedDatabases,
  canWrite,
  onOpenRow,
  onCreateRowWithProps,
  onUpdateProperty,
  onUpdateRelation,
}: {
  properties: PropertyDefinition[];
  view: DatabaseView;
  rows: DatabaseRow[];
  members: PersonOption[];
  relatedDatabases: Record<string, TargetDatabaseSummary>;
  canWrite: boolean;
  onOpenRow: (rowId: string) => void;
  onCreateRowWithProps: (initialProps: Record<string, PropertyValue | null>) => void;
  onUpdateProperty: (rowId: string, propertyId: string, value: PropertyValue | null) => void;
  onUpdateRelation: (rowId: string, propertyId: string, add: string[], remove: string[]) => void;
}) {
  const [dragInfo, setDragInfo] = useState<{ rowId: string; fromKey: string | null } | null>(null);
  const [overKey, setOverKey] = useState<string | null | "__none">("__none");

  const groupDef =
    properties.find((p) => p.id === view.groupPropertyId && isGroupableProperty(p)) ??
    properties.find((p) => isGroupableProperty(p));

  if (!groupDef) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-sidebar/40 p-8 text-center text-xs text-ink-3">
        看板视图需要至少一个「单选 / 多选 / 人员 / 复选框」字段作为分组依据，请先添加字段。
      </div>
    );
  }

  const groups = groupRows(rows, groupDef, members);
  const cardFields = viewColumns(properties, view).filter((c) => c.type !== "title" && c.id !== groupDef.id);

  const handleDrop = (e: DragEvent, toKey: string | null) => {
    e.preventDefault();
    setOverKey("__none");
    if (!dragInfo || !canWrite) return;
    const { rowId, fromKey } = dragInfo;
    setDragInfo(null);
    if (fromKey === toKey) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const nextVal = groupMoveValue(groupDef, cellValue(row, groupDef), fromKey, toKey);
    onUpdateProperty(rowId, groupDef.id, nextVal);
  };

  const initialPropsForGroup = (key: string | null): Record<string, PropertyValue | null> => {
    if (key === null) return {};
    if (groupDef.type === "checkbox") return { [groupDef.id]: key === "true" };
    if (groupDef.type === "multi_select") return { [groupDef.id]: [key] };
    return { [groupDef.id]: key };
  };

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-3">
      {groups.map((g) => {
        const colKey = g.key ?? "__null";
        const isOver = overKey === (g.key ?? null);
        const dotColor = g.color ? OPTION_COLOR_STYLE[g.color as OptionColor]?.dot : "bg-slate-400";
        return (
          <div
            key={colKey}
            onDragOver={(e) => {
              if (!dragInfo || !canWrite) return;
              e.preventDefault();
              setOverKey(g.key);
            }}
            onDragLeave={() => isOver && setOverKey("__none")}
            onDrop={(e) => handleDrop(e, g.key)}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-lg border border-line bg-sidebar/60 p-2 transition-colors",
              isOver && "border-accent bg-accent-soft/40",
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={cn("size-2 shrink-0 rounded-full", dotColor)} />
                <span className="truncate text-xs font-semibold text-ink">{g.label}</span>
                <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-ink-3">{g.rows.length}</span>
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => onCreateRowWithProps(initialPropsForGroup(g.key))}
                  className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                  title="在此列新建记录"
                >
                  <Plus className="size-3.5" />
                </button>
              )}
            </div>

            <div className="space-y-2">
              {g.rows.map((row) => (
                <div
                  key={`${colKey}:${row.id}`}
                  draggable={canWrite}
                  onDragStart={() => setDragInfo({ rowId: row.id, fromKey: g.key })}
                  onDragEnd={() => {
                    setDragInfo(null);
                    setOverKey("__none");
                  }}
                  onClick={() => onOpenRow(row.id)}
                  className="cursor-pointer rounded-md border border-line bg-white p-2.5 shadow-2xs transition-shadow hover:border-line-strong hover:shadow-xs"
                >
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    {row.icon && <span>{row.icon}</span>}
                    <span className="truncate">{row.title || "无标题"}</span>
                  </div>
                  {cardFields.length > 0 && (
                    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                      {cardFields.slice(0, 5).map((f) => (
                        <div key={f.id} className="flex items-center gap-2 text-[11px]">
                          <span className="w-16 shrink-0 truncate text-ink-3">{f.name}</span>
                          <div className="min-w-0 flex-1">
                            <DatabaseCell
                              row={row}
                              def={f}
                              members={members}
                              relatedDatabases={relatedDatabases}
                              canWrite={canWrite}
                              compact
                              onUpdateProperty={(propId, val) => onUpdateProperty(row.id, propId, val)}
                              onUpdateRelation={(propId, add, rem) => onUpdateRelation(row.id, propId, add, rem)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canWrite && (
              <button
                type="button"
                onClick={() => onCreateRowWithProps(initialPropsForGroup(g.key))}
                className="mt-2 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-3 hover:bg-hover hover:text-ink"
              >
                <Plus className="size-3.5" />
                新建
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
