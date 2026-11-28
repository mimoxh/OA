"use client";

import { Dialog as D } from "radix-ui";
import { lazy, Suspense, useEffect, useMemo, type ComponentType } from "react";
import { Download, X } from "lucide-react";
import { decidePreview, formatBytes, isDarkPreview, type PreviewKind } from "@/lib/file-preview/kinds";
import { setMobileSystemBarsStyle, useIsMobileApp } from "@/lib/mobile-bridge";
import { useIsMobileLayout } from "@/components/mobile/use-mobile-layout";
import { cn } from "@/lib/utils";
import { PreviewError, PreviewLoading } from "./preview-states";
import type { PreviewBodyProps } from "./types";

// 各格式的渲染器与解析库都按需加载：打开对应类型的文件时才下载，不影响聊天页和文档页的首屏体积
const BODIES: Partial<Record<PreviewKind, ComponentType<PreviewBodyProps>>> = {
  pdf: lazy(() => import("./bodies/pdf-body")),
  docx: lazy(() => import("./bodies/docx-body")),
  sheet: lazy(() => import("./bodies/sheet-body")),
  pptx: lazy(() => import("./bodies/pptx-body")),
  markdown: lazy(() => import("./bodies/text-body")),
  json: lazy(() => import("./bodies/text-body")),
  text: lazy(() => import("./bodies/text-body")),
  image: lazy(() => import("./bodies/image-body")),
  svg: lazy(() => import("./bodies/image-body")),
  video: lazy(() => import("./bodies/media-body")),
  audio: lazy(() => import("./bodies/media-body")),
  zip: lazy(() => import("./bodies/zip-body")),
};

export type PreviewFile = {
  /** 预览用地址（同源，带登录 Cookie；不带 ?download=1） */
  url: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
  downloadHref: string;
};

/** 点击文件时怎么处理：页内预览 / 打开预览窗口显示原因 / 直接下载（未知类型，保持原来的行为） */
export function filePreviewMode(file: Pick<PreviewFile, "fileName" | "mimeType" | "size">) {
  return decidePreview({ fileName: file.fileName, mimeType: file.mimeType, size: file.size }).mode;
}

/**
 * 统一的文件预览窗口：手机（App 与手机浏览器）全屏，让出状态栏和导航栏；电脑为居中的大弹窗。
 * 顶栏显示文件名和「下载」；Android 返回键与 Esc 关闭（Radix Dialog，返回键由 AppRuntime 转成 Esc）。
 */
export function FilePreviewDialog({ open, onOpenChange, file }: { open: boolean; onOpenChange: (open: boolean) => void; file: PreviewFile }) {
  const mobile = useIsMobileLayout();
  const app = useIsMobileApp();
  const fullscreen = mobile || app;
  const decision = useMemo(() => decidePreview({ fileName: file.fileName, mimeType: file.mimeType, size: file.size }), [file.fileName, file.mimeType, file.size]);
  const kind = decision.info.kind;
  const dark = isDarkPreview(kind);

  useEffect(() => {
    if (!open || !fullscreen || !dark) return;
    // 深色全屏预览：状态栏 / 导航栏图标切成浅色，关闭后恢复
    setMobileSystemBarsStyle("DARK");
    return () => setMobileSystemBarsStyle("DEFAULT");
  }, [open, fullscreen, dark]);

  const Body = decision.mode === "preview" ? BODIES[kind] : undefined;
  const size = Number(file.size) || 0;
  const meta = [decision.info.label, size ? formatBytes(size) : ""].filter(Boolean).join(" · ");

  const download = (
    <a
      href={file.downloadHref}
      download={file.fileName}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px]",
        dark ? "bg-white/15 text-white hover:bg-white/25 active:bg-white/25" : "bg-accent text-white hover:bg-accent-hover",
      )}
      data-preview-download
    >
      <Download className="size-4" />
      下载
    </a>
  );

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        {!fullscreen && <D.Overlay className="fixed inset-0 z-[60] bg-black/40 animate-fade-in" />}
        <D.Content
          aria-describedby={undefined}
          data-file-preview={kind}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed z-[60] flex flex-col overflow-hidden focus:outline-none",
            fullscreen
              ? "inset-0"
              : "left-1/2 top-1/2 h-[min(880px,calc(100vh-3rem))] w-[min(1200px,calc(100vw-4rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl shadow-pop animate-pop-in",
            dark ? "bg-[#2b2b2e]" : "bg-[#f3f3f1]",
          )}
        >
          {fullscreen ? (
            <div className={cn("flex shrink-0 items-center gap-1 pt-[var(--sat)]", dark ? "bg-[#1f1f22] text-white" : "border-b border-line bg-white text-ink")} data-preview-header>
              <D.Close className="p-3" aria-label="关闭">
                <X className="size-6" />
              </D.Close>
              <div className="min-w-0 flex-1 text-center">
                <D.Title className={cn("truncate text-sm", dark ? "text-white/90" : "font-medium text-ink")}>{file.fileName}</D.Title>
                {meta && <div className={cn("truncate text-[11px]", dark ? "text-white/50" : "text-ink-3")}>{meta}</div>}
              </div>
              <div className="mr-2">{download}</div>
            </div>
          ) : (
            <div className={cn("flex h-12 shrink-0 items-center gap-3 pl-4 pr-2", dark ? "bg-[#1f1f22] text-white" : "border-b border-line bg-white text-ink")} data-preview-header>
              <div className="min-w-0 flex-1">
                <D.Title className={cn("truncate text-[14px] font-medium", dark ? "text-white/90" : "text-ink")}>{file.fileName}</D.Title>
                {meta && <div className={cn("truncate text-[11px]", dark ? "text-white/50" : "text-ink-3")}>{meta}</div>}
              </div>
              {download}
              <D.Close className={cn("rounded-md p-2", dark ? "text-white/80 hover:bg-white/10" : "text-ink-3 hover:bg-hover hover:text-ink")} aria-label="关闭">
                <X className="size-5" />
              </D.Close>
            </div>
          )}
          <div className={cn("relative min-h-0 flex-1", fullscreen && "mb-[var(--sab)]")} data-preview-body>
            {open &&
              (Body ? (
                <Suspense fallback={<PreviewLoading dark={dark} label="正在加载预览组件…" />}>
                  <Body
                    src={file.url}
                    fileName={file.fileName}
                    size={size || undefined}
                    info={decision.info}
                    downloadHref={file.downloadHref}
                    fullscreen={fullscreen}
                    dark={dark}
                  />
                </Suspense>
              ) : (
                <PreviewError
                  failure={decision.mode === "fallback" ? decision.reason : { title: "暂不支持预览该类型文件", detail: "可以下载后用其他应用打开。" }}
                  downloadHref={file.downloadHref}
                  fileName={file.fileName}
                  dark={dark}
                />
              ))}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
