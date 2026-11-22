"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { SchemaHistoryDetail, SchemaHistorySummary } from "@/lib/docs/database/types";

const KIND_LABEL: Record<SchemaHistorySummary["kind"], string> = {
  create: "初始化",
  update: "修改结构",
  relation: "建立关联",
  restore: "恢复版本",
};

export function SchemaHistoryDialog({
  open,
  onOpenChange,
  databaseId,
  currentRevision,
  canWrite,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  databaseId: string;
  currentRevision: number;
  canWrite: boolean;
  onRestored: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<SchemaHistorySummary[]>([]);
  const [selectedRev, setSelectedRev] = useState<number | null>(null);
  const [detail, setDetail] = useState<SchemaHistoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreNotes, setRestoreNotes] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch(`/api/docs/databases/${databaseId}/history?limit=30`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data: { versions?: SchemaHistorySummary[] }) => {
        const list = data.versions ?? [];
        setVersions(list);
        setSelectedRev(list[0]?.revision ?? null);
        setRestoreNotes([]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [open, databaseId, currentRevision]);

  useEffect(() => {
    if (!open || selectedRev === null) return;
    const ctrl = new AbortController();
    fetch(`/api/docs/databases/${databaseId}/history/${selectedRev}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: SchemaHistoryDetail) => setDetail(d))
      .catch(() => {});
    return () => ctrl.abort();
  }, [open, databaseId, selectedRev]);

  const handleRestore = async () => {
    if (selectedRev === null) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/docs/databases/${databaseId}/history/${selectedRev}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: currentRevision }),
      });
      const data = (await res.json()) as { notes?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "恢复失败");
      setRestoreNotes(data.notes ?? []);
      toast.success(`已恢复到结构版本 #${selectedRev}`);
      await onRestored();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "恢复失败");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="结构变更历史" className="max-w-3xl">
        <div className="grid h-[420px] grid-cols-[260px_1fr] gap-4 text-xs">
          {/* Version list */}
          <div className="overflow-y-auto rounded-lg border border-line bg-sidebar/40 p-1.5">
            {loading && <div className="p-3 text-ink-3">加载中...</div>}
            {versions.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center gap-1 py-10 text-ink-3">
                <History className="size-5" />
                暂无历史版本
              </div>
            )}
            {versions.map((v) => (
              <button
                key={v.revision}
                type="button"
                onClick={() => setSelectedRev(v.revision)}
                className={cn(
                  "mb-1 w-full rounded-md p-2 text-left transition-colors",
                  selectedRev === v.revision ? "bg-white shadow-xs ring-1 ring-accent/40" : "hover:bg-white/70",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink">
                    v{v.revision} · {KIND_LABEL[v.kind]}
                    {v.sourceRevision ? ` (#${v.sourceRevision})` : ""}
                  </span>
                  {v.revision === currentRevision && (
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      当前
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
                  {v.actor && <Avatar name={v.actor.name} color={v.actor.avatarColor} size={14} />}
                  <span>{v.actor?.name ?? "系统"}</span>
                  <span>·</span>
                  <span>{formatDateTime(v.createdAt)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-ink-2">
                  {v.changes[0]}
                  {v.totalChanges > 1 ? ` 等 ${v.totalChanges} 项变更` : ""}
                </div>
              </button>
            ))}
          </div>

          {/* Selected detail */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-white p-3">
            {!detail ? (
              <div className="flex flex-1 items-center justify-center text-ink-3">选择一个版本查看详情</div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-line pb-2.5">
                  <div>
                    <div className="text-sm font-semibold text-ink">
                      版本 #{detail.revision}（{KIND_LABEL[detail.kind]}）
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-3">{formatDateTime(detail.createdAt)}</div>
                  </div>
                  {canWrite && detail.revision !== currentRevision && (
                    <Button size="sm" variant="primary" loading={restoring} onClick={handleRestore}>
                      <RotateCcw className="size-3.5" />
                      恢复到此版本
                    </Button>
                  )}
                </div>
                <div className="mt-2.5 flex-1 space-y-3 overflow-y-auto pr-1">
                  {restoreNotes.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-900">
                      <div className="font-medium">恢复说明（行数据已完整保留）：</div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {restoreNotes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <div className="mb-1 font-medium text-ink-2">本次变更摘要（共 {detail.totalChanges} 项）</div>
                    <ul className="list-disc space-y-1 pl-4 text-ink">
                      {detail.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                  {detail.revision !== currentRevision && (
                    <div>
                      <div className="mb-1 font-medium text-ink-2">若恢复到此版本，相对当前结构将产生：</div>
                      <ul className="list-disc space-y-1 pl-4 text-ink-2">
                        {detail.diffFromCurrent.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <div className="mb-1 font-medium text-ink-2">
                      快照包含 {detail.properties.filter((p) => !p.deletedAt).length} 个启用字段、{detail.views.length} 个视图
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
