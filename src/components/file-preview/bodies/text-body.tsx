"use client";

import "@/components/docs/editor/editor.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { decodeText, ENCODING_LABEL, looksBinary } from "@/lib/file-preview/decode";
import { formatBytes, TEXT_PREVIEW_BYTES } from "@/lib/file-preview/kinds";
import { renderMarkdownSafe } from "@/lib/file-preview/markdown";
import { sanitizeTree } from "@/lib/file-preview/safe-html";
import { cn } from "@/lib/utils";
import { PreviewError, PreviewLoading, PreviewNotice } from "../preview-states";
import type { PreviewBodyProps } from "../types";
import { useFileBytes } from "../use-file-bytes";

/** 行数超过这个值时不显示行号栏（行号是一整段文本，很便宜，但几十万行时意义不大） */
const MAX_GUTTER_LINES = 50_000;
/** 小于这个大小的 JSON 才做格式化（JSON.parse + stringify 的内存约为原文的数倍） */
const JSON_FORMAT_LIMIT = 2 * 1024 * 1024;

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-md px-2.5 py-1 text-xs", on ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-hover")}
      aria-pressed={on}
    >
      {children}
    </button>
  );
}

function MarkdownView({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // 渲染器已转义原始 HTML、过滤了链接；这里再按 DOM 清理一遍，双重保险
  useLayoutEffect(() => {
    if (ref.current) sanitizeTree(ref.current);
  }, [html]);
  return (
    <div className="mx-auto max-w-[860px] px-4 py-4 md:px-8 md:py-6">
      <div ref={ref} className="doc-prose md-preview [&_.md-image-placeholder]:text-ink-3 [&_table]:block [&_table]:overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} data-md-preview />
    </div>
  );
}

/**
 * 文本类（txt / log / json / md / 配置 / 代码）：自动识别 UTF-8 / GBK，只读取前 1 MB；
 * 内容一律作为文本节点渲染（React 自动转义），HTML / SVG 源码不会被执行；Markdown 走安全渲染。
 */
export default function TextBody({ src, fileName, size, info, downloadHref, fullscreen, dark }: PreviewBodyProps) {
  const bytes = useFileBytes(src, { size, limit: TEXT_PREVIEW_BYTES });
  const isMd = info.kind === "markdown";
  const isJson = info.kind === "json";
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const [wrap, setWrap] = useState(info.ext === "txt" || info.ext === "log" || info.ext === "md" || info.ext === "markdown" || fullscreen);

  const decoded = useMemo(() => {
    if (bytes.kind !== "ready") return null;
    if (looksBinary(bytes.bytes)) return { binary: true as const };
    const { text, encoding } = decodeText(bytes.bytes, bytes.truncated);
    let pretty: string | null = null;
    if (isJson && !bytes.truncated && bytes.bytes.length <= JSON_FORMAT_LIMIT) {
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        pretty = null;
      }
    }
    const html = isMd ? renderMarkdownSafe(text) : null;
    return { binary: false as const, text, encoding, pretty, html };
  }, [bytes, isJson, isMd]);

  if (bytes.kind === "error") return <PreviewError dark={dark} failure={bytes.failure} downloadHref={downloadHref} fileName={fileName} />;
  if (bytes.kind === "loading" || !decoded) {
    return <PreviewLoading dark={dark} loaded={bytes.kind === "loading" ? bytes.loaded : 0} total={bytes.kind === "loading" ? bytes.total : 0} />;
  }
  if (decoded.binary) {
    return (
      <PreviewError
        dark={dark}
        failure={{ title: "无法以文本方式显示", detail: "文件里包含二进制内容，看起来不是文本文件。可以下载后用对应的应用打开。" }}
        downloadHref={downloadHref}
        fileName={fileName}
      />
    );
  }

  const showRendered = mode === "rendered" && (isMd || (isJson && decoded.pretty != null));
  const body = isJson && mode === "rendered" && decoded.pretty != null ? decoded.pretty : decoded.text;
  const lines = showRendered && isMd ? 0 : body.split("\n").length;
  const gutter = !wrap && lines > 1 && lines <= MAX_GUTTER_LINES;

  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-white px-2 py-1.5" data-text-toolbar>
        {isMd && (
          <>
            <Toggle on={mode === "rendered"} onClick={() => setMode("rendered")}>预览</Toggle>
            <Toggle on={mode === "source"} onClick={() => setMode("source")}>源码</Toggle>
          </>
        )}
        {isJson && decoded.pretty != null && (
          <>
            <Toggle on={mode === "rendered"} onClick={() => setMode("rendered")}>格式化</Toggle>
            <Toggle on={mode === "source"} onClick={() => setMode("source")}>原文</Toggle>
          </>
        )}
        {!(showRendered && isMd) && (
          <Toggle on={wrap} onClick={() => setWrap((v) => !v)}>
            自动换行
          </Toggle>
        )}
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-3" data-text-encoding>
          {ENCODING_LABEL[decoded.encoding]}
          {lines > 0 && ` · ${lines.toLocaleString()} 行`}
        </span>
      </div>
      {bytes.truncated && (
        <PreviewNotice tone="warn">
          文件较大（{formatBytes(bytes.total)}），只显示前 {formatBytes(TEXT_PREVIEW_BYTES)}。完整内容请下载查看。
        </PreviewNotice>
      )}
      {isJson && !decoded.pretty && !bytes.truncated && mode === "rendered" && bytes.bytes.length <= JSON_FORMAT_LIMIT && (
        <PreviewNotice>JSON 格式有误，按原文显示。</PreviewNotice>
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" data-text-scroller>
        {showRendered && isMd ? (
          <MarkdownView html={decoded.html ?? ""} />
        ) : (
          <div className="flex min-w-max text-[12.5px] leading-[1.6]" style={wrap ? { minWidth: 0 } : undefined}>
            {gutter && (
              <pre className="sticky left-0 shrink-0 select-none border-r border-line bg-sidebar px-2 py-2 text-right font-mono text-ink-3" aria-hidden>
                {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
              </pre>
            )}
            <pre className={cn("min-w-0 flex-1 px-3 py-2 font-mono text-ink", wrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "whitespace-pre")} data-text-content>
              {body}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
