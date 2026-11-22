"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Hit = { id: string; title: string; icon: string; space: string };

/** “链接到页面”选择器 */
export function PagePickerDialog({
  open,
  onOpenChange,
  onPick,
  excludeId,
  kind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (hit: Hit) => void;
  excludeId?: string;
  kind?: "whiteboard";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PickerBody onPick={onPick} excludeId={excludeId} kind={kind} />}
    </Dialog>
  );
}

function PickerBody({ onPick, excludeId, kind }: { onPick: (hit: Hit) => void; excludeId?: string; kind?: "whiteboard" }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const query = new URLSearchParams({ q });
      if (kind) query.set("kind", kind);
      fetch(`/api/docs/search?${query}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setHits((d.results as Hit[]).filter((h) => h.id !== excludeId));
          setIndex(0);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, excludeId, kind]);

  const list = hits ?? [];
  return (
    <DialogContent title={kind === "whiteboard" ? "嵌入白板" : "链接到页面"} description={kind === "whiteboard" ? undefined : "搜索并选择要引用的文档"}>
      <div className="pb-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && list[index]) {
                e.preventDefault();
                onPick(list[index]);
              }
            }}
            placeholder={kind === "whiteboard" ? "搜索白板…" : "搜索页面标题或内容…"}
            className="h-9 w-full rounded-md border border-line-strong pl-8 pr-2 text-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          />
        </label>
        <div className="mt-2 max-h-[320px] overflow-y-auto">
          {hits === null && <div className="py-6 text-center text-sm text-ink-3">加载中…</div>}
          {hits?.length === 0 && <div className="py-6 text-center text-sm text-ink-3">{kind === "whiteboard" ? "没有找到白板" : "没有找到页面"}</div>}
          {list.map((h, i) => (
            <button
              key={h.id}
              type="button"
              onMouseEnter={() => setIndex(i)}
              onClick={() => onPick(h)}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", i === index && "bg-hover")}
            >
              <span className="text-base">{h.icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{h.title}</span>
              <span className="shrink-0 text-xs text-ink-3">{h.space}</span>
            </button>
          ))}
        </div>
      </div>
    </DialogContent>
  );
}
