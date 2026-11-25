"use client";

import { Dialog as D } from "radix-ui";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Download, X } from "lucide-react";

type Pt = { x: number; y: number };
const MAX_SCALE = 5;

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 手机全屏看图：双指缩放、放大后拖动、双击放大 / 还原、单击关闭。
 * 下载走普通链接（带 ?download=1），App 内由原生下载器接管。
 */
export function ImageViewer({
  open,
  onOpenChange,
  src,
  alt,
  downloadHref,
  downloadName,
  downloadLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  downloadHref: string;
  downloadName: string;
  downloadLabel: string;
}) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ dist: number; scale: number; mid: Pt; x: number; y: number; moved: boolean } | null>(null);
  /** 本轮触摸中是否出现过多指；多指松开时是逐个抬起的，最后一指不能当成单击 */
  const multiTouch = useRef(false);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  const begin = () => {
    const pts = [...pointers.current.values()];
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gesture.current = { dist: pts.length > 1 ? dist(pts[0], pts[1]) : 0, scale: view.scale, mid, x: view.x, y: view.y, moved: false };
  };

  const onDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) multiTouch.current = true;
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
      const scale = Math.min(MAX_SCALE, Math.max(1, (g.scale * dist(pts[0], pts[1])) / g.dist));
      g.moved = true;
      setView({ scale, x: g.x + (mid.x - g.mid.x), y: g.y + (mid.y - g.mid.y) });
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
    const wasMulti = multiTouch.current;
    multiTouch.current = false;
    gesture.current = null;
    setDragging(false);
    if (view.scale <= 1.02) reset();
    if (wasMulti || g?.moved) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => onOpenChange(false), 280);
  };

  return (
    <D.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <D.Portal>
        <D.Content className="fixed inset-0 z-[60] flex flex-col bg-black focus:outline-none" aria-describedby={undefined}>
          <D.Title className="sr-only">{alt}</D.Title>
          <div className="flex shrink-0 items-center justify-between pt-[var(--sat)] text-white">
            <D.Close className="p-3" aria-label="关闭">
              <X className="size-6" />
            </D.Close>
            <span className="min-w-0 flex-1 truncate text-center text-sm text-white/80">{alt}</span>
            <span className="w-12" />
          </div>
          <div
            className="relative min-h-0 flex-1 touch-none overflow-hidden"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                transition: dragging ? "none" : "transform 160ms ease-out",
              }}
            />
          </div>
          <div className="flex shrink-0 justify-center pb-[calc(var(--sab)+12px)] pt-3">
            <a
              href={downloadHref}
              download={downloadName}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm text-white active:bg-white/25"
            >
              <Download className="size-4" />
              {downloadLabel}
            </a>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
