"use client";

import Link from "next/link";
import { ExternalLink, Trash2, X } from "lucide-react";
import { activeProperties } from "@/lib/docs/database/engine";
import type {
  DatabaseRow,
  PersonOption,
  PropertyDefinition,
  PropertyValue,
  TargetDatabaseSummary,
} from "@/lib/docs/database/types";
import { DatabaseCell, PropertyTypeIcon } from "./cells";

export function RowDrawer({
  row,
  properties,
  members,
  relatedDatabases,
  canWrite,
  onClose,
  onUpdateTitle,
  onUpdateProperty,
  onUpdateRelation,
  onDeleteRow,
}: {
  row: DatabaseRow | null;
  properties: PropertyDefinition[];
  members: PersonOption[];
  relatedDatabases: Record<string, TargetDatabaseSummary>;
  canWrite: boolean;
  onClose: () => void;
  onUpdateTitle: (rowId: string, title: string) => void;
  onUpdateProperty: (rowId: string, propertyId: string, value: PropertyValue | null) => void;
  onUpdateRelation: (rowId: string, propertyId: string, add: string[], remove: string[]) => void;
  onDeleteRow: (rowId: string) => void;
}) {
  if (!row) return null;
  const fields = activeProperties(properties).filter((p) => p.type !== "title");

  return (
    <div className="fixed inset-x-0 bottom-0 top-app z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-line bg-white shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <Link
            href={`/docs/${row.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-hover hover:text-ink"
          >
            <ExternalLink className="size-3.5" />
            打开完整行文档
          </Link>
          <div className="flex items-center gap-1">
            {canWrite && (
              <button
                type="button"
                onClick={() => {
                  onDeleteRow(row.id);
                  onClose();
                }}
                className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-rose-50 hover:text-rose-600"
                title="移到回收站"
              >
                <Trash2 className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
              title="关闭"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <input
            key={row.id}
            defaultValue={row.title}
            disabled={!canWrite}
            placeholder="无标题"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== row.title) onUpdateTitle(row.id, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full bg-transparent text-2xl font-bold text-ink outline-none placeholder:text-ink-3"
          />

          <div className="mt-5 divide-y divide-line/60 border-y border-line/80">
            {fields.map((def) => (
              <div key={def.id} className="grid grid-cols-[130px_1fr] items-center gap-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-ink-3">
                  <PropertyTypeIcon type={def.type} className="size-3.5 shrink-0" />
                  <span className="truncate">{def.name}</span>
                </div>
                <div className="min-w-0">
                  <DatabaseCell
                    row={row}
                    def={def}
                    members={members}
                    relatedDatabases={relatedDatabases}
                    canWrite={canWrite}
                    onUpdateProperty={(propId, val) => onUpdateProperty(row.id, propId, val)}
                    onUpdateRelation={(propId, add, rem) => onUpdateRelation(row.id, propId, add, rem)}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-sidebar/40 p-4 text-xs text-ink-2">
            <p className="font-medium text-ink">完整文档正文与协作</p>
            <p className="mt-1 text-ink-3">
              每一条多维表格记录都是独立的协作文档，支持富文本正文、附件、评论与双向链接。
            </p>
            <Link
              href={`/docs/${row.id}`}
              className="mt-2.5 inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              前往编辑正文、评论与反链
              <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
