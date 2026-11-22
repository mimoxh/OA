"use client";

import { Plus } from "lucide-react";
import { viewColumns } from "@/lib/docs/database/engine";
import type {
  DatabaseRow,
  DatabaseView,
  PersonOption,
  PropertyDefinition,
  PropertyValue,
  TargetDatabaseSummary,
} from "@/lib/docs/database/types";
import { DatabaseCell } from "../cells";

export function GalleryView({
  properties,
  view,
  rows,
  members,
  relatedDatabases,
  canWrite,
  onOpenRow,
  onCreateRow,
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
  onCreateRow: () => void;
  onUpdateProperty: (rowId: string, propertyId: string, value: PropertyValue | null) => void;
  onUpdateRelation: (rowId: string, propertyId: string, add: string[], remove: string[]) => void;
}) {
  const fields = viewColumns(properties, view).filter((c) => c.type !== "title");

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => (
        <div
          key={row.id}
          onClick={() => onOpenRow(row.id)}
          className="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-line bg-white transition-all hover:border-line-strong hover:shadow-sm"
        >
          <div
            className="flex h-20 items-center justify-center bg-gradient-to-br from-sidebar to-hover/70 text-3xl"
            style={row.cover ? { background: row.cover } : undefined}
          >
            {row.icon || "📄"}
          </div>
          <div className="flex flex-1 flex-col p-3">
            <div className="truncate text-sm font-semibold text-ink">{row.title || "无标题"}</div>
            {fields.length > 0 && (
              <div className="mt-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                {fields.slice(0, 6).map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 truncate text-[11px] text-ink-3">{f.name}</span>
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
        </div>
      ))}
      {canWrite && (
        <button
          type="button"
          onClick={onCreateRow}
          className="flex min-h-[168px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-sidebar/30 text-xs text-ink-3 transition-colors hover:border-accent hover:bg-accent-soft/30 hover:text-accent"
        >
          <Plus className="size-5" />
          新建记录卡片
        </button>
      )}
    </div>
  );
}
