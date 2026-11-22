"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { History, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAction } from "@/components/ui/use-action";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parseContent } from "@/lib/docs/content";
import type { WhiteboardReference } from "@/lib/docs/whiteboard/content";
import { getVersion, listVersions, restoreVersion } from "@/app/(app)/docs/actions";
import { StaticDoc } from "./editor/static-doc";

type VersionRow = { id: string; title: string; createdAt: string; author: { name: string; avatarColor: string } };
type VersionPreview = { id: string; title: string; content: string; references?: WhiteboardReference[] };
type PreviewOptions = { renderPreview?: (version: VersionPreview) => ReactNode; onRestored?: (title: string) => void };

export function HistoryDialog({
  open,
  onOpenChange,
  docId,
  canRestore,
  onSaveCurrent,
  renderPreview,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  docId: string;
  canRestore: boolean;
  onSaveCurrent?: () => Promise<boolean>;
} & PreviewOptions) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <HistoryBody
        docId={docId} canRestore={canRestore} onSaveCurrent={onSaveCurrent} onClose={() => onOpenChange(false)}
        renderPreview={renderPreview} onRestored={onRestored}
      />}
    </Dialog>
  );
}

function HistoryBody({
  docId,
  canRestore,
  onSaveCurrent,
  onClose,
  renderPreview,
  onRestored,
}: {
  docId: string;
  canRestore: boolean;
  onSaveCurrent?: () => Promise<boolean>;
  onClose: () => void;
} & PreviewOptions) {
  const { run, pending } = useAction();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    listVersions(docId).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        toast.error(r.error);
        setRows([]);
        return;
      }
      setRows(r.data);
      setSelected((s) => s ?? r.data[0]?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, [docId, reload]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    getVersion(selected).then((r) => {
      if (alive && r.ok) setPreview(r.data);
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  const content = useMemo(() => (preview ? parseContent(preview.content) : null), [preview]);
  const current = rows?.find((r) => r.id === selected);

  return (
    <DialogContent
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <History className="size-4 text-ink-2" />
          历史版本
        </span>
      }
      description="编辑时每隔 10 分钟自动保存一个版本，也可以手动保存当前版本"
      className="max-h-[84vh] top-[8vh]"
      footer={
        <>
          {onSaveCurrent && (
            <Button
              className="mr-auto"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                const ok = await onSaveCurrent();
                setSaving(false);
                if (ok) {
                  setSelected(null);
                  setReload((x) => x + 1);
                }
              }}
            >
              <Save className="size-3.5" />
              保存当前版本
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
          {canRestore && (
            <Button
              variant="primary"
              disabled={!selected || pending}
              loading={pending}
              onClick={() =>
                selected &&
                run(() => restoreVersion(selected), {
                  success: "已恢复到所选版本",
                  onSuccess: () => {
                    if (current) onRestored?.(current.title);
                    onClose();
                  },
                })
              }
            >
              <RotateCcw className="size-3.5" />
              恢复此版本
            </Button>
          )}
        </>
      }
    >
      <div className="flex h-[58vh] gap-4 pb-2">
        <div className="w-56 shrink-0 overflow-y-auto border-r border-line pr-2">
          {rows === null && (
            <div className="flex items-center gap-2 px-2 py-4 text-sm text-ink-3">
              <Loader2 className="size-4 animate-spin" />
              加载中…
            </div>
          )}
          {rows?.length === 0 && <div className="px-2 py-4 text-sm text-ink-3">暂无历史版本</div>}
          {rows?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={cn("mb-0.5 block w-full rounded-md px-2 py-1.5 text-left hover:bg-hover", selected === r.id && "bg-active/80")}
            >
              <div className="text-[13px] font-medium text-ink">{formatDateTime(r.createdAt)}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
                <Avatar name={r.author.name} color={r.author.avatarColor} size={16} />
                {r.author.name}
                <span className="text-ink-3">· {formatRelative(r.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto rounded-md border border-line px-8 py-6">
          {current && preview && content ? (
            <>
              <h1 className="mb-4 text-[28px] font-bold text-ink">{preview.title || "无标题"}</h1>
              {renderPreview ? renderPreview(preview) : <StaticDoc key={preview.id} content={content} />}
            </>
          ) : (
            <div className="py-10 text-center text-sm text-ink-3">{rows?.length ? "选择左侧版本进行预览" : "暂无可预览的内容"}</div>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
