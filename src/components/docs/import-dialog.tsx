"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const ACCEPT = ".md,.markdown,.txt,.zip";
const MD_EXT = /\.(md|markdown|txt)$/i;
const MD_MAX = 1024 * 1024;
const TOTAL_MAX = 50 * 1024 * 1024;

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export type ImportResult = {
  created: { id: string; title: string; parentId: string | null }[];
  rootIds: string[];
  warnings: { file: string; message: string }[];
};

export function ImportDialog({
  spaceId,
  parentId,
  open,
  onOpenChange,
}: {
  spaceId: string;
  parentId?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [warnings, setWarnings] = useState<ImportResult["warnings"]>([]);
  const [pending, setPending] = useState(false);

  const close = () => {
    setFiles([]);
    setWarnings([]);
    onOpenChange(false);
  };

  const pick = (list: FileList | null) => {
    const ok = [...(list ?? [])].filter((f) => /\.(md|markdown|txt|zip)$/i.test(f.name));
    if (ok.length !== (list?.length ?? 0)) toast.error("仅支持 .md / .markdown / .txt / .zip 文件");
    const big = ok.find((f) => f.size > TOTAL_MAX || (MD_EXT.test(f.name) && f.size > MD_MAX));
    if (big) {
      toast.error(`「${big.name}」超过大小限制`);
      return;
    }
    const total = [...files, ...ok].reduce((sum, f) => sum + f.size, 0);
    if (total > TOTAL_MAX) {
      toast.error("所选文件总大小超过 50MB 限制");
      return;
    }
    setWarnings([]);
    setFiles((prev) => [...prev, ...ok]);
  };

  const submit = async () => {
    if (!files.length || pending) return;
    setPending(true);
    try {
      const form = new FormData();
      form.set("spaceId", spaceId);
      if (parentId) form.set("parentId", parentId);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/docs/import", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as (Partial<ImportResult> & { error?: string }) | null;
      if (!res.ok || !data) {
        toast.error(data?.error ?? `导入失败（${res.status}）`);
        return;
      }
      const ws = data.warnings ?? [];
      if (ws.length) {
        setFiles([]);
        setWarnings(ws);
      } else close();
      toast.success(`已导入 ${data.created?.length ?? 0} 个页面`);
      const first = data.rootIds?.[0];
      router.refresh();
      if (first) router.push(`/docs/${first}`);
    } catch {
      toast.error("导入失败，请重试");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      {open && (
        <DialogContent
          title="导入 Markdown"
          description="支持 .md / .markdown / .txt 文件，以及导出 ZIP（含页面层级与附件）"
          footer={
            <>
              <Button variant="ghost" onClick={close} disabled={pending}>
                {warnings.length ? "关闭" : "取消"}
              </Button>
              <Button variant="primary" onClick={() => void submit()} disabled={!files.length || pending}>
                <Upload className="size-3.5" />
                {pending ? "导入中…" : "导入"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-4 py-6 text-sm text-ink-2 hover:bg-sidebar"
            >
              <FileUp className="size-5 text-ink-3" />
              选择文件（可多选）
              <span className="text-xs text-ink-3">单个 Markdown 不超过 1MB</span>
            </button>
            <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            {files.length > 0 && (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                {files.map((f, i) => (
                  <li key={i} className="group flex items-center gap-2 rounded px-1 py-0.5 text-[13px] text-ink-2 hover:bg-hover/60">
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-ink-3">{fmtSize(f.size)}</span>
                    <IconButton title="移除" className="opacity-0 group-hover:opacity-100" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            {warnings.length > 0 && (
              <div className="rounded-lg border border-line bg-sidebar px-3 py-2">
                <div className="mb-1 text-xs font-medium text-ink-2">导入完成，但有 {warnings.length} 条提示：</div>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-ink-2">
                  {warnings.map((w, i) => (
                    <li key={i}>
                      <span className="text-ink-3">{w.file}：</span>
                      {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
