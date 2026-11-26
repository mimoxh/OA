"use client";

import { Dialog as D } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, FileWarning, X } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";

/** pdf.js 的 worker、CMap（中文等非嵌入字体必需）、标准字体与解码器，由 /api/pdfjs 从依赖包里直接提供 */
const ASSETS = "/api/pdfjs/";
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const PAGE_GAP = 8;
const SIDE_PAD = 8;
/** 单页画布像素上限：放大后按比例降低清晰度，避免大页面把 WebView 内存撑爆 */
const MAX_CANVAS_PIXELS = 8_000_000;
/** 可见页前后各保留几页的画布，更远的释放 */
const RENDER_AHEAD = 2;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  // legacy 构建：兼容较旧的 Android System WebView 与手机浏览器
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then(
    (m) => {
      m.GlobalWorkerOptions.workerSrc = `${ASSETS}worker?v=${m.version}`;
      return m;
    },
    (e) => {
      pdfjsPromise = null;
      throw e;
    },
  );
  return pdfjsPromise;
}

type Failure = { title: string; detail: string };

type LoadState =
  | { kind: "loading"; loaded: number; total: number; parsing: boolean }
  | { kind: "ready"; doc: PDFDocumentProxy; ratios: number[] }
  | { kind: "error"; failure: Failure };

export function isPdfFile(mimeType: string | null | undefined, fileName: string | null | undefined) {
  return (mimeType ?? "").split(";")[0].trim().toLowerCase() === "application/pdf" || /\.pdf$/i.test(fileName ?? "");
}

function describeError(e: unknown): Failure {
  const err = e as { name?: string; status?: number; message?: string } | null;
  switch (err?.name) {
    case "PasswordException":
      return { title: "该 PDF 已加密", detail: "需要密码才能打开，暂不支持在线预览。可以下载后用其他应用输入密码查看。" };
    case "InvalidPDFException":
      return { title: "无法解析该文件", detail: "文件已损坏或不是有效的 PDF。可以下载后用其他应用尝试打开。" };
    case "ResponseException": {
      const s = err.status ?? 0;
      if (s === 401) return { title: "登录已失效", detail: "请重新登录后再预览。" };
      if (s === 403 || s === 404) return { title: "文件不可用", detail: "文件不存在或你没有权限查看。" };
      return { title: "文件加载失败", detail: s ? `服务器返回 HTTP ${s}，请稍后重试或下载查看。` : "网络连接中断，请稍后重试或下载查看。" };
    }
    default:
      return { title: "预览失败", detail: err?.message ? `无法预览该文件（${err.message}）。可以下载后查看。` : "无法预览该文件，可以下载后查看。" };
  }
}

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function PdfPage({
  doc,
  index,
  width,
  height,
  active,
  onRatio,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  height: number;
  active: boolean;
  onRatio: (index: number, ratio: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!active) {
      for (const c of el.querySelectorAll("canvas")) {
        c.width = 0;
        c.height = 0;
        c.remove();
      }
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    void doc.getPage(index + 1).then((page) => {
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      onRatio(index, base.height / base.width);
      const viewport = page.getViewport({ scale: width / base.width });
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      // 画到新画布上再替换旧画布：缩放后重绘期间仍显示拉伸的旧画面，不会闪白
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * scale);
      canvas.height = Math.floor(viewport.height * scale);
      canvas.className = "absolute inset-0 size-full";
      task = page.render({
        canvas,
        viewport,
        transform: scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0],
      });
      task.promise.then(
        () => {
          if (cancelled) return;
          for (const c of el.querySelectorAll("canvas")) {
            c.width = 0;
            c.height = 0;
            c.remove();
          }
          el.appendChild(canvas);
        },
        () => {},
      );
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, width, active, onRatio]);

  return (
    <div
      ref={box}
      data-pdf-page={index + 1}
      className="relative mx-auto bg-white shadow-sm"
      style={{ width, height, marginBottom: PAGE_GAP }}
    >
      {/* 画布绘制完成前显示页码占位（画布叠在它上面） */}
      <span className="absolute inset-0 flex items-center justify-center text-xs text-ink-3">{index + 1}</span>
    </div>
  );
}

/**
 * 手机全屏 PDF 预览（App 与手机浏览器）：pdf.js 渲染，纵向滚动翻页、双指缩放、双击放大 / 还原、页码、下载。
 * 只渲染可见页附近的页面；加密 / 损坏的文件给出说明并提供下载。Android 返回键与 Esc 关闭（Radix Dialog）。
 */
export function PdfViewer({
  open,
  onOpenChange,
  src,
  fileName,
  size,
  downloadHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PDF 地址（同源，带登录 Cookie） */
  src: string;
  fileName: string;
  /** 已知的文件大小，服务端没给 Content-Length 时用于显示进度 */
  size?: number;
  downloadHref: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading", loaded: 0, total: size ?? 0, parsing: false });
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [current, setCurrent] = useState(1);
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "loading", loaded: 0, total: size ?? 0, parsing: false });
    setZoom(1);
    setCurrent(1);
    let lastPct = -1;
    loadPdfJs()
      .then((pdfjs) => {
        if (cancelled) return null;
        task = pdfjs.getDocument({
          url: src,
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          wasmUrl: `${ASSETS}wasm/`,
          iccUrl: `${ASSETS}iccs/`,
          enableXfa: false,
        });
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          const t = total || size || 0;
          const pct = t ? Math.floor((loaded / t) * 100) : Math.floor(loaded / 262144);
          if (pct === lastPct) return;
          lastPct = pct;
          setState((s) => (s.kind === "loading" ? { kind: "loading", loaded, total: t, parsing: !!t && loaded >= t } : s));
        };
        return task.promise;
      })
      .then(async (doc) => {
        if (!doc || cancelled) return;
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        setState({ kind: "ready", doc, ratios: Array.from({ length: doc.numPages }, () => first.height / first.width) });
      })
      .catch((e) => {
        if (!cancelled) setState({ kind: "error", failure: describeError(e) });
      });
    return () => {
      cancelled = true;
      void (task as PDFDocumentLoadingTask | null)?.destroy();
    };
  }, [open, src, size]);

  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const doc = state.kind === "ready" ? state.doc : null;
  const ratios = state.kind === "ready" ? state.ratios : null;
  const pageWidth = Math.max(0, (containerWidth - SIDE_PAD * 2) * zoom);
  const tops = useMemo(() => {
    if (!ratios) return [];
    const out: number[] = [];
    let y = SIDE_PAD;
    for (const r of ratios) {
      out.push(y);
      y += Math.round(pageWidth * r) + PAGE_GAP;
    }
    out.push(y);
    return out;
  }, [ratios, pageWidth]);

  const onRatio = useCallback((index: number, ratio: number) => {
    setState((s) => {
      if (s.kind !== "ready" || Math.abs(s.ratios[index] - ratio) < 0.001) return s;
      const ratios = s.ratios.slice();
      ratios[index] = ratio;
      return { ...s, ratios };
    });
  }, []);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el || tops.length < 2) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    const n = tops.length - 1;
    let first = 0;
    while (first < n - 1 && tops[first + 1] <= top) first++;
    let last = first;
    while (last < n - 1 && tops[last + 1] < bottom) last++;
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    // 页码取视口上三分之一处所在的页
    const probe = top + el.clientHeight / 3;
    let cur = first;
    while (cur < n - 1 && tops[cur + 1] <= probe) cur++;
    setCurrent(cur + 1);
  }, [tops]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const c = content.current;
    if (c) {
      c.style.transform = "";
      c.style.transformOrigin = "";
    }
    if (el && pendingScroll.current) {
      el.scrollLeft = pendingScroll.current.left;
      el.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
    measure();
  }, [zoom, measure]);

  // 双指缩放：手势进行中只对内容做 CSS 缩放，松手后按新倍数重排并重绘，保持手指下的内容不动
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let pinch: { dist: number; cx: number; cy: number; fx: number; fy: number; s: number } | null = null;
    let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
    let lastTap = 0;
    const zoomRef = { value: zoom };

    const commit = (s: number, cx: number, cy: number, fx: number, fy: number) => {
      const next = Math.min(MAX_ZOOM, Math.max(1, zoomRef.value * s));
      const k = next / zoomRef.value;
      pendingScroll.current = { left: Math.max(0, fx * k - cx), top: Math.max(0, fy * k - cy) };
      if (next === zoomRef.value) {
        const c = content.current;
        if (c) c.style.transform = "";
        pendingScroll.current = null;
        return;
      }
      setZoom(next);
    };

    const point = (t: Touch) => {
      const rect = el.getBoundingClientRect();
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const a = point(e.touches[0]);
        const b = point(e.touches[1]);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx, cy, fx: el.scrollLeft + cx, fy: el.scrollTop + cy, s: 1 };
        tap = null;
        lastTap = 0;
      } else if (e.touches.length === 1) {
        const p = point(e.touches[0]);
        tap = { x: p.x, y: p.y, t: Date.now(), moved: false };
      } else {
        tap = null;
      }
    };

    const onMove = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        const a = point(e.touches[0]);
        const b = point(e.touches[1]);
        const raw = Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist;
        pinch.s = Math.min(MAX_ZOOM / zoomRef.value, Math.max(1 / zoomRef.value, raw));
        const c = content.current;
        if (c) {
          c.style.transformOrigin = `${pinch.fx}px ${pinch.fy}px`;
          c.style.transform = `scale(${pinch.s})`;
        }
        return;
      }
      if (tap && e.touches.length === 1) {
        const p = point(e.touches[0]);
        if (Math.abs(p.x - tap.x) + Math.abs(p.y - tap.y) > 10) tap.moved = true;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        if (e.touches.length < 2) {
          const p = pinch;
          pinch = null;
          commit(p.s, p.cx, p.cy, p.fx, p.fy);
        }
        return;
      }
      if (!tap || tap.moved || e.touches.length > 0 || Date.now() - tap.t > 300) {
        tap = null;
        return;
      }
      const now = Date.now();
      const { x, y } = tap;
      tap = null;
      if (now - lastTap < 300) {
        lastTap = 0;
        const target = zoomRef.value > 1.05 ? 1 : DOUBLE_TAP_ZOOM;
        commit(target / zoomRef.value, x, y, el.scrollLeft + x, el.scrollTop + y);
        return;
      }
      lastTap = now;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [doc, zoom]);

  const total = doc?.numPages ?? 0;
  const contentHeight = tops.length ? tops[tops.length - 1] + SIDE_PAD : 0;

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Content className="fixed inset-0 z-[60] flex flex-col bg-[#2b2b2e] focus:outline-none" aria-describedby={undefined}>
          <div className="flex shrink-0 items-center gap-1 bg-[#1f1f22] pt-[var(--sat)] text-white">
            <D.Close className="p-3" aria-label="关闭">
              <X className="size-6" />
            </D.Close>
            <D.Title className="min-w-0 flex-1 truncate text-center text-sm text-white/90">{fileName}</D.Title>
            <a
              href={downloadHref}
              download={fileName}
              className="mr-2 inline-flex h-8 items-center gap-1 rounded-full bg-white/15 px-3 text-[13px] text-white active:bg-white/25"
            >
              <Download className="size-4" />
              下载
            </a>
          </div>

          {state.kind === "loading" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-white/85">
              <div className="h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: state.total ? `${Math.min(100, (state.loaded / state.total) * 100)}%` : "30%" }}
                />
              </div>
              <div className="text-[13px]" data-pdf-progress>
                {state.parsing
                  ? "正在解析…"
                  : state.total
                    ? `正在加载 ${Math.min(100, Math.floor((state.loaded / state.total) * 100))}%（${formatBytes(state.loaded)} / ${formatBytes(state.total)}）`
                    : state.loaded
                      ? `正在加载 ${formatBytes(state.loaded)}`
                      : "正在加载…"}
              </div>
            </div>
          )}

          {state.kind === "error" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-white" data-pdf-error>
              <FileWarning className="size-12 text-white/60" />
              <div className="text-base font-medium">{state.failure.title}</div>
              <div className="max-w-[300px] text-[13px] leading-relaxed text-white/70">{state.failure.detail}</div>
              <a
                href={downloadHref}
                download={fileName}
                className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-5 text-sm text-white active:opacity-90"
              >
                <Download className="size-4" />
                下载文件
              </a>
            </div>
          )}

          {state.kind === "ready" && (
            <div className="relative min-h-0 flex-1">
              <div ref={setScroller} onScroll={measure} className="absolute inset-0 touch-pan-x touch-pan-y overflow-auto overscroll-contain">
                <div
                  ref={content}
                  className="relative"
                  style={{ width: pageWidth + SIDE_PAD * 2, height: contentHeight, paddingTop: SIDE_PAD }}
                >
                  {doc &&
                    pageWidth > 0 &&
                    ratios!.map((r, i) => (
                      <PdfPage
                        key={i}
                        doc={doc}
                        index={i}
                        width={pageWidth}
                        height={Math.round(pageWidth * r)}
                        active={i >= range[0] - RENDER_AHEAD && i <= range[1] + RENDER_AHEAD}
                        onRatio={onRatio}
                      />
                    ))}
                </div>
              </div>
              <div
                className="pointer-events-none absolute bottom-[calc(var(--sab)+16px)] left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white tabular-nums"
                data-pdf-page-indicator
              >
                {current} / {total}
                {zoom > 1.01 && <span className="ml-2 text-white/70">{Math.round(zoom * 100)}%</span>}
              </div>
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
