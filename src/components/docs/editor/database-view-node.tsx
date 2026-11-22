"use client";

import { useEffect, useState, type SyntheticEvent } from "react";
import Link from "next/link";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ExternalLink, Table2, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DatabaseViewNode } from "@/lib/docs/schema";
import { DatabaseWorkspace } from "../database/database-workspace";

function DatabaseViewBlock({ node, editor, updateAttributes, deleteNode }: NodeViewProps) {
  const databaseId = String(node.attrs.databaseId ?? "");
  const viewId = typeof node.attrs.viewId === "string" ? node.attrs.viewId : null;
  const editable = editor.isEditable;
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  if (!databaseId) {
    return (
      <NodeViewWrapper
        className="my-3 rounded-lg border border-dashed border-line-strong bg-sidebar/40 p-4 text-xs text-ink-3"
        data-type="database-view"
      >
        无效的多维表格视图引用
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className="my-4 rounded-xl border border-line bg-white p-3 shadow-2xs"
      data-type="database-view"
      contentEditable={false}
      onKeyDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onCopy={stop}
      onCut={stop}
      onPaste={stop}
    >
      <div className="mb-2 flex items-center justify-between border-b border-line/70 pb-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-ink-2">
          <Table2 className="size-3.5 text-accent" />
          <span>内嵌多维表格</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/docs/${databaseId}`}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-ink-2 hover:bg-hover hover:text-accent"
          >
            打开完整表格
            <ExternalLink className="size-3" />
          </Link>
          {editable && (
            <button
              type="button"
              onClick={() => deleteNode()}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-ink-3 hover:bg-rose-50 hover:text-rose-600"
              title="从正文移除此视图（不删除原多维表格）"
            >
              <Trash2 className="size-3" />
              移除
            </button>
          )}
        </div>
      </div>
      <DatabaseWorkspace
        databaseId={databaseId}
        initialViewId={viewId}
        compact
        onActiveViewChange={(nextViewId) => {
          if (editable && nextViewId !== viewId) {
            updateAttributes({ viewId: nextViewId });
          }
        }}
      />
    </NodeViewWrapper>
  );
}

/** databaseView 节点的 React 渲染版（仅客户端编辑器使用；schema 本体在 lib/docs/schema） */
export const DatabaseViewExtension = DatabaseViewNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseViewBlock, {
      stopEvent: () => true,
    });
  },
});

interface DatabasePickerItem {
  id: string;
  title: string;
  icon: string | null;
  spaceName: string;
  views: { id: string; name: string; type: string }[];
}

export function DatabaseLinkPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (databaseId: string, viewId: string | null) => void;
}) {
  const [items, setItems] = useState<DatabasePickerItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch("/api/docs/databases", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: { databases?: DatabasePickerItem[] }) => setItems(d.databases ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [open]);

  const needle = q.trim().toLowerCase();
  const filtered = items.filter(
    (d) => !needle || d.title.toLowerCase().includes(needle) || d.spaceName.toLowerCase().includes(needle),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="关联已有多维表格" className="max-w-md">
        <div className="space-y-3 text-xs">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索多维表格名称..."
            className="h-8 w-full rounded-md border border-line px-2.5 text-sm outline-none focus:border-accent"
          />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {loading && <div className="py-6 text-center text-ink-3">加载中…</div>}
            {!loading && filtered.length === 0 && (
              <div className="py-6 text-center text-ink-3">暂无可关联的多维表格</div>
            )}
            {filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onSelect(d.id, d.views[0]?.id ?? null);
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left hover:border-line hover:bg-hover/60"
              >
                <span className="text-base">{d.icon || "🗃️"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{d.title}</div>
                  <div className="truncate text-[11px] text-ink-3">
                    {d.spaceName} · {d.views.length} 个视图
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
