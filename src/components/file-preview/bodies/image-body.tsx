"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { IMAGE_MIME_BY_EXT, PREVIEW_LIMITS } from "@/lib/file-preview/kinds";
import { cn } from "@/lib/utils";
import { PreviewError, PreviewLoading, ZoomControls } from "../preview-states";
import type { PreviewBodyProps } from "../types";
import { useFileBytes } from "../use-file-bytes";

type Pt = { x: number; y: number };
const MAX_SCALE = 6;
const MIN_SCALE = 1;

/**
 * 图片（含 SVG）：读取后按扩展名生成 blob: 地址，用 <img> 显示——SVG 在 <img> 里不会执行脚本，也不加载外部资源。
 * 双指缩放、拖动、双击放大 / 还原，缩放按钮，电脑上滚轮缩放。
 */
export default function ImageBody({ src, fileName, size, info, downloadHref, fullscreen, dark }: PreviewBodyProps) {
  const bytes = useFileBytes(src, { size, limit: (PREVIEW_LIMITS[info.kind] ?? 0) + 1 });
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ dist: number; scale: number; mid: Pt; x: number; y: number; moved: boolean } | null>(null);
  const multi = useRef(false);
  const lastTap = useRef(0);

  useEffect(() => {
    if (bytes.kind !== "ready") return;
    const type = IMAGE_MIME_BY_EXT[info.ext] ?? "application/octet-stream";
    const u = URL.createObjectURL(new Blob([bytes.bytes as Uint8Array<ArrayBuffer>], { type }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, info.ext]);

  const clamp = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  const begin = () => {
    const pts = [...pointers.current.values()];
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gesture.current = { dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, scale: view.scale, mid, x: view.x, y: view.y, moved: false };
  };
  const onDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) multi.current = true;
    setDragging(true);
    begin();
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length > 1 && g.dist > 0) {
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      g.moved = true;
      setView({ scale: clamp((g.scale * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.dist), x: g.x + (mid.x - g.mid.x), y: g.y + (mid.y - g.mid.y) });
    } else if (pts.length === 1) {
      const dx = pts[0].x - g.mid.x;
      const dy = pts[0].y - g.mid.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (g.scale > 1) setView((v) => ({ ...v, x: g.x + dx, y: g.y + dy }));
    }
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0) {
      begin();
      return;
    }
    const wasMulti = multi.current;
    multi.current = false;
    gesture.current = null;
    setDragging(false);
    if (view.scale <= 1.02) setView({ scale: 1, x: 0, y: 0 });
    if (wasMulti || g?.moved) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
      return;
    }
    lastTap.current = now;
  };
  const onWheel = (e: WheelEvent) => {
    if (fullscreen) return;
    setView((v) => {
      const scale = clamp(v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      return scale <= 1.001 ? { scale: 1, x: 0, y: 0 } : { ...v, scale };
    });
  };

  if (bytes.kind === "error") return <PreviewError dark={dark} failure={bytes.failure} downloadHref={downloadHref} fileName={fileName} />;
  if (bytes.kind === "loading" || !url) {
    return <PreviewLoading dark={dark} loaded={bytes.kind === "loading" ? bytes.loaded : 0} total={bytes.kind === "loading" ? bytes.total : 0} />;
  }
  if (broken) {
    return (
      <PreviewError
        dark={dark}
        failure={{ title: "无法显示该图片", detail: "文件已损坏，或当前设备不支持这种图片格式。可以下载后用相册或看图软件打开。" }}
        downloadHref={downloadHref}
        fileName={fileName}
      />
    );
  }
  return (
    <>
      <div
        className={cn("absolute inset-0 touch-none overflow-hidden", view.scale > 1 ? "cursor-grab" : "cursor-zoom-in", dragging && view.scale > 1 && "cursor-grabbing")}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        data-image-stage
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={fileName}
          draggable={false}
          onError={() => setBroken(true)}
          className={cn("absolute inset-0 m-auto max-h-[calc(100%-16px)] max-w-[calc(100%-16px)] select-none object-contain", info.kind === "svg" && "min-h-[40%] min-w-[40%] bg-white")}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: dragging ? "none" : "transform 160ms ease-out" }}
        />
      </div>
      <ZoomControls
        dark
        zoom={view.scale}
        min={MIN_SCALE}
        max={MAX_SCALE}
        className="absolute bottom-3 right-3"
        onZoom={(z) => setView((v) => (z <= 1.001 ? { scale: 1, x: 0, y: 0 } : { ...v, scale: z }))}
      />
    </>
  );
}
