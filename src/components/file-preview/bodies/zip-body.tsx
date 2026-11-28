"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File as FileIcon, Folder, Lock } from "lucide-react";
import { formatBytes, ZIP_MAX_ENTRIES } from "@/lib/file-preview/kinds";
import { corrupted, type PreviewFailure } from "@/lib/file-preview/sniff";
import { readZipDirectory, zipTreeRows, type ZipDirectory } from "@/lib/file-preview/zip-directory";
import { cn } from "@/lib/utils";
import { PreviewError, PreviewLoading, PreviewNotice } from "../preview-states";
import type { PreviewBodyProps } from "../types";
import { fetchBytes, httpFailure, rangeReader } from "../use-file-bytes";

/** 条目很多时默认只展开第一层 */
const EXPAND_ALL_UNDER = 300;

/**
 * ZIP 压缩包：只读取文件末尾的目录区（Range 请求），列出目录树、文件大小；不解压，提示下载后查看。
 */
export default function ZipBody({ src, fileName, size, info, downloadHref, dark }: PreviewBodyProps) {
  const [dir, setDir] = useState<ZipDirectory | null>(null);
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      let total = size;
      let read = rangeReader(src, ac.signal);
      if (!total) {
        const whole = await fetchBytes(src, { signal: ac.signal });
        total = whole.bytes.length;
        read = async (a, b) => whole.bytes.subarray(a, b);
      }
      return readZipDirectory(read, total, ZIP_MAX_ENTRIES);
    })().then(
      (d) => !ac.signal.aborted && setDir(d),
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setFailure((e as Error)?.name === "ZipFormatError" ? corrupted(info.label) : httpFailure(e));
      },
    );
    return () => ac.abort();
  }, [src, size, info.label]);

  const rows = useMemo(() => (dir ? zipTreeRows(dir.entries) : []), [dir]);
  const shut = useMemo(
    () => collapsed ?? new Set(rows.length > EXPAND_ALL_UNDER ? rows.filter((r) => r.dir && r.depth >= 0).map((r) => r.path) : []),
    [collapsed, rows],
  );
  const visible = useMemo(() => {
    const out: typeof rows = [];
    let hideBelow = Infinity;
    for (const r of rows) {
      if (r.depth > hideBelow) continue;
      hideBelow = Infinity;
      out.push(r);
      if (r.dir && shut.has(r.path)) hideBelow = r.depth;
    }
    return out;
  }, [rows, shut]);

  if (failure) return <PreviewError dark={dark} failure={failure} downloadHref={downloadHref} fileName={fileName} />;
  if (!dir) return <PreviewLoading dark={dark} label="正在读取压缩包目录…" />;

  const files = dir.entries.filter((e) => !e.dir).length;
  const toggle = (p: string) =>
    setCollapsed(() => {
      const next = new Set(shut);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <div className="shrink-0 border-b border-line px-4 py-2.5 text-[13px] text-ink-2" data-zip-summary>
        共 {dir.total.toLocaleString()} 项{files !== dir.total && `（文件 ${files.toLocaleString()} 个）`}，解压后约 {formatBytes(dir.totalSize)}
        <div className="mt-0.5 text-xs text-ink-3">页内只能查看目录，压缩包里的文件需要下载后解压查看。</div>
      </div>
      {dir.suspicious && <PreviewNotice tone="warn">解压后的体积异常大（{formatBytes(dir.totalSize)}），可能是恶意的压缩炸弹，请谨慎解压。</PreviewNotice>}
      {dir.encrypted && <PreviewNotice tone="warn">压缩包里有加密的文件（带锁图标），解压时需要密码。</PreviewNotice>}
      {dir.truncated && <PreviewNotice>条目较多，只列出前 {dir.entries.length.toLocaleString()} 项。</PreviewNotice>}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain py-1" data-zip-list>
        {visible.length === 0 && <div className="py-10 text-center text-sm text-ink-3">压缩包是空的</div>}
        {visible.map((r) => (
          <div
            key={r.path}
            className={cn("flex min-h-9 items-center gap-1.5 pr-4 text-[13px] text-ink", r.dir && "cursor-pointer hover:bg-hover")}
            style={{ paddingLeft: 12 + r.depth * 16 }}
            onClick={r.dir ? () => toggle(r.path) : undefined}
            data-zip-row={r.dir ? "dir" : "file"}
          >
            {r.dir ? (
              <>
                {shut.has(r.path) ? <ChevronRight className="size-3.5 shrink-0 text-ink-3" /> : <ChevronDown className="size-3.5 shrink-0 text-ink-3" />}
                <Folder className="size-4 shrink-0 text-amber-500" />
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                <FileIcon className="size-4 shrink-0 text-ink-3" />
              </>
            )}
            <span className="min-w-0 flex-1 truncate" title={r.path}>
              {r.name}
            </span>
            {r.encrypted && <Lock className="size-3.5 shrink-0 text-amber-600" aria-label="已加密" />}
            {!r.dir && <span className="shrink-0 text-xs text-ink-3 tabular-nums">{formatBytes(r.size)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
