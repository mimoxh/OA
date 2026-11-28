"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { ExternalLink, GitFork, X } from "lucide-react";
import { GraphView } from "./graph-view";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: string;
  docTitle: string;
  spaceId: string;
};

/** 文档页内弹出的大尺寸关系图对话框，默认以当前文档为中心进入局部模式 */
export function GraphDialog({ open, onOpenChange, docId, docTitle, spaceId }: Props) {
  const router = useRouter();
  const fullGraphHref = `/docs/graph?space=${encodeURIComponent(spaceId)}&focus=${encodeURIComponent(docId)}`;

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 animate-fade-in" />
        <D.Content className="fixed left-1/2 top-1/2 z-50 flex h-[88vh] w-[94vw] max-w-[1440px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-pop animate-pop-in focus:outline-none max-md:top-[calc(50%+(var(--sat)-var(--sab))/2)] max-md:h-[min(88dvh,calc(100dvh-var(--sat)-var(--sab)-1.5rem))]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <GitFork className="size-4 shrink-0 text-accent" />
              <D.Title className="truncate text-sm font-semibold text-ink">
                关系图 · {docTitle || "无标题"}
              </D.Title>
              <D.Description className="sr-only">
                查看当前文档及其关联页面的双向引用关系图
              </D.Description>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                href={fullGraphHref}
                onClick={() => onOpenChange(false)}
                className="flex h-7 items-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
              >
                <ExternalLink className="size-3.5" />
                独立页面打开
              </Link>
              <D.Close
                className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
                aria-label="关闭关系图"
              >
                <X className="size-4" />
              </D.Close>
            </div>
          </div>

          {open && (
            <GraphView
              initialFocusId={docId}
              initialLocal={true}
              initialDepth={1}
              onNavigate={(targetId) => {
                onOpenChange(false);
                if (targetId !== docId) router.push(`/docs/${targetId}`);
              }}
            />
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
