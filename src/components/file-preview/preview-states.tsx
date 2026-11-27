"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Download, FileWarning } from "lucide-react";
import { formatBytes } from "@/lib/file-preview/kinds";
import type { PreviewFailure } from "@/lib/file-preview/sniff";
import { cn } from "@/lib/utils";

export function PreviewLoading({ loaded = 0, total = 0, label, dark }: { loaded?: number; total?: number; label?: string; dark: boolean }) {
  const pct = total ? Math.min(100, Math.floor((loaded / total) * 100)) : 0;
  return (
    <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-3 px-10", dark ? "text-white/85" : "text-ink-2")} data-preview-loading>
      <div className={cn("h-1.5 w-full max-w-[260px] overflow-hidden rounded-full", dark ? "bg-white/15" : "bg-black/10")}>
        <div
          className={cn("h-full rounded-full bg-accent transition-[width] duration-150", !total && "animate-pulse")}
          style={{ width: total ? `${pct}%` : "30%" }}
        />
      </div>
      <div className="text-[13px]" data-pdf-progress>
        {label ??
          (total && loaded
            ? loaded >= total
              ? "正在解析…"
              : `正在加载 ${pct}%（${formatBytes(loaded)} / ${formatBytes(total)}）`
            : loaded
              ? `正在加载 ${formatBytes(loaded)}`
              : "正在加载…")}
      </div>
    </div>
  );
}

export function DownloadButton({ href, fileName, label = "下载文件", className }: { href: string; fileName: string; label?: string; className?: string }) {
  return (
    <a
      href={href}
      download={fileName}
      className={cn("inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-5 text-sm text-white hover:bg-accent-hover active:opacity-90", className)}
    >
      <Download className="size-4" />
      {label}
    </a>
  );
}

export function PreviewError({
  failure,
  downloadHref,
  fileName,
  dark,
  children,
}: {
  failure: PreviewFailure;
  downloadHref: string;
  fileName: string;
  dark: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto px-8 text-center", dark ? "text-white" : "text-ink")} data-pdf-error data-preview-error>
      <FileWarning className={cn("size-12", dark ? "text-white/60" : "text-ink-3")} />
      <div className="text-base font-medium">{failure.title}</div>
      {failure.detail && <div className={cn("max-w-[340px] text-[13px] leading-relaxed", dark ? "text-white/70" : "text-ink-2")}>{failure.detail}</div>}
      {children}
      <DownloadButton href={downloadHref} fileName={fileName} className="mt-2" />
    </div>
  );
}

/** 内容上方的提示条（截断、编码、异常提示） */
export function PreviewNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-1.5 border-b px-3 py-1.5 text-xs leading-relaxed",
        tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-line bg-sidebar text-ink-2",
      )}
      data-preview-notice
    >
      {tone === "warn" && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function ZoomControls({
  zoom,
  onZoom,
  min,
  max,
  dark,
  className,
}: {
  zoom: number;
  onZoom: (next: number) => void;
  min: number;
  max: number;
  dark: boolean;
  className?: string;
}) {
  const btn = cn("flex size-8 items-center justify-center rounded-full text-base leading-none disabled:opacity-40", dark ? "hover:bg-white/15 active:bg-white/25" : "hover:bg-hover active:bg-active");
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full px-1 py-0.5 text-xs tabular-nums shadow-pop",
        dark ? "bg-black/70 text-white" : "bg-white/95 text-ink",
        className,
      )}
      data-zoom-controls
    >
      <button type="button" className={btn} aria-label="缩小" disabled={zoom <= min + 0.001} onClick={() => onZoom(Math.max(min, zoom / 1.25))}>
        −
      </button>
      <button type="button" className="min-w-12 px-1 text-center" aria-label="还原" onClick={() => onZoom(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={btn} aria-label="放大" disabled={zoom >= max - 0.001} onClick={() => onZoom(Math.min(max, zoom * 1.25))}>
        +
      </button>
    </div>
  );
}
