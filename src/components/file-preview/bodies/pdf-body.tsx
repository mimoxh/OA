"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PreviewFailure } from "@/lib/file-preview/sniff";
import { PreviewError, PreviewLoading, ZoomControls } from "../preview-states";
import type { PreviewBodyProps } from "../types";

/** pdf.js 的 worker、CMap（中文等非嵌入字体必需）、标准字体与解码器，由 /api/pdfjs 从依赖包里直接提供 */
const ASSETS = "/api/pdfjs/";
const MAX_ZOOM = 4;
/** 电脑上可以缩小到一半（手机上最小就是适应宽度） */
const MIN_ZOOM_DESKTOP = 0.5;
const DOUBLE_TAP_ZOOM = 2.5;
const PAGE_GAP = 8;
const SIDE_PAD = 8;
/** 电脑弹窗里适应宽度时的最大页宽，避免整页铺满 1200px 宽 */
const DESKTOP_FIT_WIDTH = 920;
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

type LoadState =
  | { kind: "loading"; loaded: number; total: number; parsing: boolean }
  | { kind: "ready"; doc: PDFDocumentProxy; ratios: number[] }
  | { kind: "error"; failure: PreviewFailure };

function describeError(e: unknown): PreviewFailure {
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
 * PDF：pdf.js 渲染，纵向滚动翻页、双指缩放、双击放大 / 还原（手机），缩放按钮（电脑），页码。
 * 只渲染可见页附近的页面；加密 / 损坏的文件给出说明并提供下载。
 */
export default function PdfBody({ src, fileName, size, downloadHref, fullscreen }: PreviewBodyProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading", loaded: 0, total: size ?? 0, parsing: false });
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [current, setCurrent] = useState(1);
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomRef = useRef(zoom);
  const minZoom = fullscreen ? 1 : MIN_ZOOM_DESKTOP;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
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
  }, [src, size]);

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
  const fitWidth = Math.max(0, containerWidth - SIDE_PAD * 2);
  const pageWidth = (fullscreen ? fitWidth : Math.min(fitWidth, DESKTOP_FIT_WIDTH)) * zoom;
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

  /** 以视口内 (cx, cy) 为中心缩放到 next 倍，保持该点下的内容不动 */
  const zoomAt = useCallback(
    (next: number, cx: number, cy: number) => {
      const el = scroller.current;
      const cur = zoomRef.current;
      next = Math.min(MAX_ZOOM, Math.max(minZoom, next));
      if (!el || next === cur) {
        const c = content.current;
        if (c) c.style.transform = "";
        return;
      }
      const k = next / cur;
      pendingScroll.current = { left: Math.max(0, (el.scrollLeft + cx) * k - cx), top: Math.max(0, (el.scrollTop + cy) * k - cy) };
      setZoom(next);
    },
    [minZoom],
  );

  // 双指缩放：手势进行中只对内容做 CSS 缩放，松手后按新倍数重排并重绘，保持手指下的内容不动
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let pinch: { dist: number; cx: number; cy: number; fx: number; fy: number; s: number } | null = null;
    let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
    let lastTap = 0;

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
        const z = zoomRef.current;
        pinch.s = Math.min(MAX_ZOOM / z, Math.max(minZoom / z, raw));
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
          zoomAt(zoomRef.current * p.s, p.cx, p.cy);
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
        zoomAt(zoomRef.current > 1.05 ? 1 : DOUBLE_TAP_ZOOM, x, y);
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
  }, [doc, zoomAt, minZoom]);

  const total = doc?.numPages ?? 0;
  const contentHeight = tops.length ? tops[tops.length - 1] + SIDE_PAD : 0;

  if (state.kind === "loading") {
    return (
      <PreviewLoading
        dark
        loaded={state.loaded}
        total={state.total}
        label={state.parsing ? "正在解析…" : undefined}
      />
    );
  }
  if (state.kind === "error") {
    return <PreviewError dark failure={state.failure} downloadHref={downloadHref} fileName={fileName} />;
  }
  return (
    <>
      <div ref={setScroller} onScroll={measure} className="absolute inset-0 touch-pan-x touch-pan-y overflow-auto overscroll-contain">
        <div
          ref={content}
          className="relative mx-auto"
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
      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
        <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-white tabular-nums" data-pdf-page-indicator>
          {current} / {total}
          {fullscreen && zoom > 1.01 && <span className="ml-2 text-white/70">{Math.round(zoom * 100)}%</span>}
        </div>
      </div>
      {!fullscreen && (
        <ZoomControls
          dark
          zoom={zoom}
          min={minZoom}
          max={MAX_ZOOM}
          className="absolute bottom-3 right-4"
          onZoom={(z) => {
            const el = scroller.current;
            zoomAt(z, (el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2);
          }}
        />
      )}
    </>
  );
}
