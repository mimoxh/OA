"use client";

import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent, type PointerEvent,
} from "react";
import {
  AlignCenterHorizontal, AlignEndHorizontal, AlignStartHorizontal, ArrowUpRight, Circle, Diamond, Eraser,
  ExternalLink, FileText, Frame, Hand, ImageDown, ImagePlus, Maximize2, Minus, MousePointer2, Pencil, Plus,
  Redo2, Square, StickyNote, TextAlignCenter, TextAlignEnd, TextAlignStart, Trash2, Type, Undo2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { randomId } from "@/lib/client-id";
import {
  exportWhiteboardPng, getWhiteboardTextEditorLayout, paintWhiteboard, type WhiteboardImages,
} from "@/lib/docs/whiteboard/canvas";
import {
  DEFAULT_WHITEBOARD_TEXT_ALIGN, DEFAULT_WHITEBOARD_VERTICAL_ALIGN, resolveWhiteboardTextAlign,
  resolveWhiteboardVerticalAlign, WHITEBOARD_COLORS, WHITEBOARD_MAX_ELEMENTS, WHITEBOARD_MAX_POINTS,
  whiteboardAttachmentIds, type WhiteboardColor, type WhiteboardElement, type WhiteboardPoint,
  type WhiteboardReference, type WhiteboardTextAlign, type WhiteboardTextElement, type WhiteboardVerticalAlign,
} from "@/lib/docs/whiteboard/content";
import {
  clampPoint, fitView, hitElement, makeArrow, makeFigure, makeStroke, offsetElement, palette, removeElement,
  resizeElement, type WhiteboardTool, type WhiteboardView,
} from "@/lib/docs/whiteboard/geometry";
import { PagePickerDialog } from "../page-picker";
import { uploadAttachment } from "../editor/upload";

const tools: { tool: WhiteboardTool; label: string; icon: LucideIcon; key?: string }[] = [
  { tool: "select", label: "选择", icon: MousePointer2, key: "v" },
  { tool: "pan", label: "抓手", icon: Hand, key: "h" },
  { tool: "rectangle", label: "矩形", icon: Square },
  { tool: "ellipse", label: "椭圆", icon: Circle },
  { tool: "diamond", label: "菱形", icon: Diamond },
  { tool: "note", label: "便签", icon: StickyNote, key: "n" },
  { tool: "text", label: "文字", icon: Type, key: "t" },
  { tool: "frame", label: "框架", icon: Frame, key: "f" },
  { tool: "pen", label: "画笔", icon: Pencil, key: "p" },
  { tool: "arrow", label: "连线", icon: ArrowUpRight, key: "c" },
  { tool: "erase", label: "橡皮擦", icon: Eraser, key: "e" },
];

const horizontalAligns: { value: WhiteboardTextAlign; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "文字左对齐", icon: TextAlignStart },
  { value: "center", label: "文字水平居中", icon: TextAlignCenter },
  { value: "right", label: "文字右对齐", icon: TextAlignEnd },
];

const verticalAligns: { value: WhiteboardVerticalAlign; label: string; icon: LucideIcon }[] = [
  { value: "top", label: "文字顶部对齐", icon: AlignStartHorizontal },
  { value: "middle", label: "文字垂直居中", icon: AlignCenterHorizontal },
  { value: "bottom", label: "文字底部对齐", icon: AlignEndHorizontal },
];

type Shape = Exclude<WhiteboardElement, { type: "arrow" }>;
type Gesture =
  | { kind: "pan"; start: WhiteboardPoint; view: WhiteboardView }
  | { kind: "move"; start: WhiteboardPoint; item: WhiteboardElement }
  | { kind: "resize"; item: Shape }
  | {
      kind: "draw";
      start: WhiteboardPoint;
      tool: Exclude<WhiteboardTool, "pan" | "select" | "erase">;
      id: string;
      points: WhiteboardPoint[];
      fromId?: string;
    };

type History = { undo: WhiteboardElement[][]; redo: WhiteboardElement[][] };

function pointOnBoard(point: WhiteboardPoint, view: WhiteboardView) {
  return clampPoint({ x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale });
}

function zoomAt(view: WhiteboardView, point: WhiteboardPoint, factor: number): WhiteboardView {
  const scale = Math.min(4, Math.max(0.02, view.scale * factor));
  const ratio = scale / view.scale;
  return { x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio, scale };
}

function replaceElement(items: WhiteboardElement[], item: WhiteboardElement) {
  return items.map((current) => current.id === item.id ? item : current);
}

export function WhiteboardCanvas({
  boardId, title, elements, references, onChange, compact = false,
}: {
  boardId: string;
  title: string;
  elements: WhiteboardElement[];
  references: WhiteboardReference[];
  onChange?: (elements: WhiteboardElement[]) => void;
  compact?: boolean;
}) {
  const [tool, setTool] = useState<WhiteboardTool>("select");
  const [color, setColor] = useState<WhiteboardColor>("blue");
  const [textAlign, setTextAlign] = useState<WhiteboardTextAlign>(DEFAULT_WHITEBOARD_TEXT_ALIGN);
  const [verticalAlign, setVerticalAlign] = useState<WhiteboardVerticalAlign>(DEFAULT_WHITEBOARD_VERTICAL_ALIGN);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<WhiteboardView | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [preview, setPreview] = useState<WhiteboardElement | null>(null);
  const [history, setHistory] = useState<History>({ undo: [], redo: [] });
  const [editor, setEditor] = useState<{ id: string; text: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [newReferences, setNewReferences] = useState<WhiteboardReference[]>([]);
  const [imageVersion, setImageVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const editorInput = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const images = useRef<WhiteboardImages>(new Map());
  const gesture = useRef<Gesture | null>(null);
  const latestElements = useRef(elements);
  const changeElements = useRef(onChange);
  const editorRef = useRef<{ id: string; text: string } | null>(null);
  const composingRef = useRef(false);
  const readOnly = !onChange;
  const activeTool = readOnly && tool !== "pan" ? "select" : tool;
  const viewport = useMemo(
    () => view ?? fitView(elements, size.width, size.height),
    [view, elements, size],
  );
  const byId = useMemo(() => new Map(elements.map((item) => [item.id, item])), [elements]);
  const active = selection ? byId.get(selection) : undefined;
  const editingItem = useMemo<WhiteboardTextElement | null>(() => {
    if (!editor || readOnly) return null;
    const item = byId.get(editor.id);
    return item && "text" in item ? item : null;
  }, [editor, readOnly, byId]);
  const editorLayout = useMemo(
    () => (editingItem ? getWhiteboardTextEditorLayout(editingItem, byId, viewport) : null),
    [editingItem, byId, viewport],
  );
  const editingId = editorLayout ? editingItem?.id ?? null : null;
  const refById = useMemo(
    () => new Map([...references, ...newReferences].map((ref) => [ref.id, ref])),
    [references, newReferences],
  );
  const attachmentKey = whiteboardAttachmentIds(elements).join(",");

  useEffect(() => {
    latestElements.current = elements;
    changeElements.current = onChange;
  }, [elements, onChange]);

  useEffect(() => {
    if (!editingId) return;
    const el = editorInput.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const item = latestElements.current.find((entry) => entry.id === editingId);
    if (item?.type === "frame" && item.text === "框架") {
      el.select();
    } else {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [editingId]);

  useLayoutEffect(() => {
    const el = editorInput.current;
    if (!el || !editorLayout) return;
    el.style.height = "0px";
    const maxHeight = Math.max(editorLayout.height, editorLayout.lineHeight);
    const nextHeight = Math.min(Math.max(el.scrollHeight, editorLayout.lineHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
  }, [editor?.text, editorLayout]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const next: WhiteboardImages = new Map();
    for (const id of attachmentKey ? attachmentKey.split(",") : []) {
      const image = images.current.get(id) ?? new Image();
      const refreshImage = () => setImageVersion((v) => v + 1);
      image.onload = refreshImage;
      image.onerror = refreshImage;
      if (!image.src) image.src = `/api/docs/attachments/${id}`;
      next.set(id, image);
    }
    images.current = next;
    return () => {
      for (const image of next.values()) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [attachmentKey]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !size.width || !size.height) return;
    const frame = requestAnimationFrame(() => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.ceil(size.width * ratio);
      const h = Math.ceil(size.height * ratio);
      if (el.width !== w) el.width = w;
      if (el.height !== h) el.height = h;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      let visibleItems = elements;
      if (preview) {
        visibleItems = elements.some((item) => item.id === preview.id)
          ? replaceElement(elements, preview)
          : [...elements, preview];
      }
      paintWhiteboard(ctx, visibleItems, {
        ...size, view: viewport, references: refById, images: images.current, grid: true,
        selectedId: selection, editingId, showResizeHandle: !readOnly,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [size, viewport, elements, selection, editingId, preview, refById, imageVersion, readOnly]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (compact && !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = event.deltaMode === 1 ? 16 : 1;
      setView((current) => {
        const previous = current ?? viewport;
        if (event.ctrlKey || event.metaKey) {
          return zoomAt(previous, { x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-event.deltaY * factor * 0.002));
        }
        return { ...previous, x: previous.x - event.deltaX * factor, y: previous.y - event.deltaY * factor };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [compact, viewport]);

  const commit = (next: WhiteboardElement[]) => {
    const change = changeElements.current;
    if (!change) return;
    if (next.length > WHITEBOARD_MAX_ELEMENTS) {
      toast.error(`白板最多包含 ${WHITEBOARD_MAX_ELEMENTS} 个元素`);
      return;
    }
    const previous = latestElements.current;
    latestElements.current = next;
    setHistory((h) => ({ undo: [...h.undo.slice(-39), previous], redo: [] }));
    change(next);
  };

  const startEditing = (item: WhiteboardTextElement) => {
    if (readOnly) return;
    const next = { id: item.id, text: item.text };
    composingRef.current = false;
    editorRef.current = next;
    setSelection(item.id);
    setEditor(next);
  };

  const updateEditorText = (text: string) => {
    const current = editorRef.current;
    if (!current) return;
    const next = { ...current, text };
    editorRef.current = next;
    setEditor(next);
  };

  const commitEditor = (focusCanvas = false) => {
    const current = editorRef.current;
    if (!current) return;
    composingRef.current = false;
    editorRef.current = null;
    setEditor(null);
    const currentElements = latestElements.current;
    const item = currentElements.find((entry) => entry.id === current.id);
    if (item && "text" in item && item.text !== current.text) {
      commit(replaceElement(currentElements, { ...item, text: current.text }));
    }
    if (focusCanvas) canvas.current?.focus({ preventScroll: true });
  };

  const cancelEditor = (focusCanvas = false) => {
    if (!editorRef.current) return;
    composingRef.current = false;
    editorRef.current = null;
    setEditor(null);
    if (focusCanvas) canvas.current?.focus({ preventScroll: true });
  };

  const keepEditorFocus = (event: MouseEvent<HTMLButtonElement>) => {
    if (editorRef.current) event.preventDefault();
  };

  const undo = () => {
    const previous = history.undo.at(-1);
    if (!previous || !onChange) return;
    cancelEditor();
    setHistory({ undo: history.undo.slice(0, -1), redo: [...history.redo, elements] });
    onChange(previous);
  };

  const redo = () => {
    const next = history.redo.at(-1);
    if (!next || !onChange) return;
    cancelEditor();
    setHistory({ undo: [...history.undo, elements], redo: history.redo.slice(0, -1) });
    onChange(next);
  };

  function screenPoint(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    if (editorRef.current) commitEditor();
    event.currentTarget.focus();
    const currentElements = latestElements.current;
    const currentActive = currentElements.find((item) => item.id === selection);
    const screen = screenPoint(event);
    const point = pointOnBoard(screen, viewport);
    setView(viewport);

    if (activeTool === "pan" || event.button === 1) {
      gesture.current = { kind: "pan", start: screen, view: viewport };
    } else if (activeTool === "select" || activeTool === "erase") {
      const tolerance = 7 / viewport.scale;
      if (activeTool === "select" && !readOnly && currentActive && currentActive.type !== "arrow" &&
        Math.hypot(point.x - currentActive.x - currentActive.width, point.y - currentActive.y - currentActive.height) <= tolerance) {
        gesture.current = { kind: "resize", item: currentActive };
      } else {
        const hit = hitElement(currentElements, point, tolerance);
        if (activeTool === "erase") {
          if (hit) commit(removeElement(currentElements, hit.id));
          setSelection(null);
          return;
        }
        setSelection(hit?.id ?? null);
        if (hit && !readOnly) gesture.current = { kind: "move", start: point, item: hit };
      }
    } else {
      const fromId = activeTool === "arrow"
        ? hitElement(currentElements, point, 5 / viewport.scale, true)?.id
        : undefined;
      gesture.current = { kind: "draw", start: point, tool: activeTool, id: randomId(), points: [point], fromId };
      setSelection(null);
    }
    if (gesture.current) event.currentTarget.setPointerCapture(event.pointerId);
  }

  function gestureElement(current: Exclude<Gesture, { kind: "pan" }>, point: WhiteboardPoint) {
    const currentElements = latestElements.current;
    if (current.kind === "move") {
      return offsetElement(current.item, point.x - current.start.x, point.y - current.start.y, currentElements);
    }
    if (current.kind === "resize") return resizeElement(current.item, point);
    if (current.tool === "arrow") {
      const endId = hitElement(currentElements, point, 5 / viewport.scale, true)?.id;
      return makeArrow(
        current.id,
        { ...current.start, ...(current.fromId ? { elementId: current.fromId } : {}) },
        { ...point, ...(endId && endId !== current.fromId ? { elementId: endId } : {}) },
        color,
        textAlign,
      );
    }
    if (current.tool === "pen") {
      const last = current.points.at(-1)!;
      if (current.points.length < WHITEBOARD_MAX_POINTS && Math.hypot(last.x - point.x, last.y - point.y) >= 1 / viewport.scale) {
        current.points.push(point);
      }
      return makeStroke(current.id, current.points, color);
    }
    return makeFigure(
      current.id,
      current.tool,
      current.start,
      point,
      current.tool === "note" && color === "blue" ? "yellow" : color,
      {
        textAlign,
        verticalAlign: current.tool === "frame" && verticalAlign === DEFAULT_WHITEBOARD_VERTICAL_ALIGN
          ? "top"
          : verticalAlign,
      },
    );
  }

  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const current = gesture.current;
    if (!current || !event.isPrimary) return;
    const screen = screenPoint(event);
    if (current.kind === "pan") {
      setView({ ...current.view, x: current.view.x + screen.x - current.start.x, y: current.view.y + screen.y - current.start.y });
      return;
    }
    setPreview(gestureElement(current, pointOnBoard(screen, viewport)));
  }

  function clearGesture() {
    gesture.current = null;
    setPreview(null);
  }

  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary) return;
    const current = gesture.current;
    clearGesture();
    if (!current || current.kind === "pan" || readOnly) return;
    const point = pointOnBoard(screenPoint(event), viewport);
    if (current.kind === "move" && Math.hypot(point.x - current.start.x, point.y - current.start.y) < 2 / viewport.scale) return;
    if (current.kind === "resize" &&
      Math.hypot(point.x - current.item.x - current.item.width, point.y - current.item.y - current.item.height) < 2 / viewport.scale) return;
    if (current.kind === "draw" && current.tool === "arrow" &&
      Math.hypot(point.x - current.start.x, point.y - current.start.y) < 8 / viewport.scale) return;
    const next = gestureElement(current, point);
    const currentElements = latestElements.current;
    commit(current.kind === "draw" ? [...currentElements, next] : replaceElement(currentElements, next));
    setSelection(next.id);
    if (current.kind === "draw") {
      setTool("select");
      if (next.type === "text" || next.type === "note") startEditing(next);
    }
  }

  function openItem(item: WhiteboardElement | null | undefined) {
    if (!item) return;
    if (item.type === "page" && refById.has(item.documentId)) {
      window.open(`/docs/${item.documentId}`, "_blank", "noopener,noreferrer");
    } else if ("text" in item && !readOnly) {
      startEditing(item);
    }
  }

  function onKeyboard(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.nativeEvent.isComposing) return;
    const key = event.key.toLowerCase();
    if (key === "escape") {
      clearGesture();
      setSelection(null);
      setTool("select");
    } else if (key === "enter" && active) {
      event.preventDefault();
      openItem(active);
    } else if (!readOnly && (event.ctrlKey || event.metaKey) && ["z", "y", "d"].includes(key)) {
      event.preventDefault();
      if (key === "z" && !event.shiftKey) undo();
      if (key === "y" || (key === "z" && event.shiftKey)) redo();
      if (key === "d" && active) {
        const copy = { ...offsetElement(active, 22, 22, elements), id: randomId() };
        commit([...elements, copy]);
        setSelection(copy.id);
      }
    } else if (!readOnly && active && ["delete", "backspace"].includes(key)) {
      event.preventDefault();
      commit(removeElement(elements, active.id));
      setSelection(null);
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const match = tools.find((entry) => entry.key === key);
      if (match && (!readOnly || match.tool === "select" || match.tool === "pan")) setTool(match.tool);
    }
  }

  const zoom = (factor: number) => setView(zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, factor));
  const insertNearCenter = (width: number, height: number) => {
    const { scale } = viewport;
    const origin = pointOnBoard({ x: (size.width - width * scale) / 2, y: (size.height - height * scale) / 2 }, viewport);
    const gap = 18 / scale;
    const candidates = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1]].map(([dx, dy]) =>
      clampPoint({ x: origin.x + dx * (width + gap), y: origin.y + dy * (height + gap) }));
    const free = ({ x, y }: WhiteboardPoint) => !latestElements.current.some((item) =>
      item.type !== "arrow" && item.type !== "frame" &&
      item.x < x + width + gap && item.x + item.width > x - gap &&
      item.y < y + height + gap && item.y + item.height > y - gap);
    const visible = ({ x, y }: WhiteboardPoint) =>
      x * scale + viewport.x >= 0 && y * scale + viewport.y >= 0 &&
      (x + width) * scale + viewport.x <= size.width && (y + height) * scale + viewport.y <= size.height;
    const position = candidates.find((p) => visible(p) && free(p)) ?? candidates.find(free) ?? origin;
    setView(visible(position) ? viewport : {
      scale,
      x: size.width / 2 - (position.x + width / 2) * scale,
      y: size.height / 2 - (position.y + height / 2) * scale,
    });
    return position;
  };
  const uploadImage = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("图片超过 10MB 大小限制");
      return;
    }
    setUploading(true);
    const localUrl = URL.createObjectURL(file);
    try {
      const previewImage = new Image();
      previewImage.src = localUrl;
      await previewImage.decode().catch(() => { throw new Error("图片文件损坏或无法读取"); });
      const image = await uploadAttachment(file, boardId);
      if (!image.mediaType.startsWith("image/")) throw new Error("请选择 PNG、JPEG、GIF 或 WebP 图片");
      const scale = Math.min(240 / previewImage.naturalWidth, 160 / previewImage.naturalHeight, 2);
      const width = Math.max(24, previewImage.naturalWidth * scale);
      const height = Math.max(24, previewImage.naturalHeight * scale);
      const item = { id: randomId(), type: "image", ...insertNearCenter(width, height), width, height, attachmentId: image.id } as const;
      commit([...latestElements.current, item]);
      setSelection(item.id);
      setTool("select");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      URL.revokeObjectURL(localUrl);
      setUploading(false);
    }
  };

  const visibleTools = readOnly ? tools.slice(0, 2) : tools;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
        {visibleTools.map(({ tool: id, label, icon: Icon, key }) => (
          <IconButton
            key={id}
            title={key ? `${label} (${key.toUpperCase()})` : label}
            aria-label={label}
            aria-pressed={activeTool === id}
            className={cn("shrink-0", activeTool === id && "bg-accent-soft text-accent")}
            onClick={() => setTool(id)}
          >
            <Icon className="size-4" />
          </IconButton>
        ))}
        {!readOnly && (
          <>
            <span className="mx-1 h-5 shrink-0 border-l border-line" />
            <IconButton title="添加文档卡片" aria-label="添加文档卡片" onClick={() => setPicker(true)}><FileText className="size-4" /></IconButton>
            <IconButton title="上传图片" aria-label="上传图片" disabled={uploading} onClick={() => imageInput.current?.click()}><ImagePlus className="size-4" /></IconButton>
            <span className="mx-1 h-5 shrink-0 border-l border-line" />
            <IconButton title="撤销 (Ctrl+Z)" aria-label="撤销" disabled={!history.undo.length} onClick={undo}><Undo2 className="size-4" /></IconButton>
            <IconButton title="重做 (Ctrl+Shift+Z)" aria-label="重做" disabled={!history.redo.length} onClick={redo}><Redo2 className="size-4" /></IconButton>
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadImage(file);
              }}
            />
          </>
        )}
      </div>

      <div ref={container} className={cn("relative overflow-hidden bg-slate-50", compact ? "h-[360px]" : "h-[max(320px,calc(100dvh-15rem))]")}>
        <canvas
          ref={canvas}
          aria-label="白板画布"
          tabIndex={0}
          className={cn("block size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            activeTool === "pan" ? "cursor-grab active:cursor-grabbing" : activeTool !== "select" && "cursor-crosshair")}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={clearGesture}
          onLostPointerCapture={clearGesture}
          onKeyDown={onKeyboard}
          onDoubleClick={(event) => {
            if (activeTool !== "select") return;
            const rect = event.currentTarget.getBoundingClientRect();
            const point = pointOnBoard({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport);
            openItem(hitElement(latestElements.current, point, 7 / viewport.scale));
          }}
          onPaste={(event) => {
            if (readOnly || uploading) return;
            const file = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
            if (!file) return;
            event.preventDefault();
            void uploadImage(file);
          }}
        />
        {editor && editingItem && editorLayout && (
          <div
            data-whiteboard-inline-editor={editingItem.id}
            className="pointer-events-none absolute flex flex-col"
            style={{
              left: `${editorLayout.left}px`,
              top: `${editorLayout.top}px`,
              width: `${Math.max(editorLayout.width, 24)}px`,
              height: `${Math.max(editorLayout.height, editorLayout.lineHeight)}px`,
              justifyContent:
                editorLayout.verticalAlign === "top"
                  ? "flex-start"
                  : editorLayout.verticalAlign === "bottom"
                    ? "flex-end"
                    : "center",
            }}
          >
            <textarea
              ref={editorInput}
              aria-label="画布文字"
              rows={1}
              spellCheck={false}
              maxLength={4_000}
              placeholder={editingItem.type === "text" || editingItem.type === "arrow" ? "输入文字" : undefined}
              value={editor.text}
              className={cn(
                "pointer-events-auto m-0 block w-full resize-none overflow-y-auto border-0 p-0 outline-none placeholder:text-slate-400/70",
                editorLayout.isArrow
                  ? "rounded bg-white/90 px-1.5 shadow-xs ring-1 ring-accent/40"
                  : "bg-transparent",
              )}
              style={{
                fontFamily: "system-ui",
                fontSize: `${editorLayout.fontSize}px`,
                lineHeight: `${editorLayout.lineHeight}px`,
                textAlign: editorLayout.textAlign,
                color: editorLayout.color,
                overflowWrap: "anywhere",
              }}
              onChange={(event) => updateEditorText(event.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onBlur={() => commitEditor()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditor(true);
                } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  commitEditor(true);
                }
              }}
            />
          </div>
        )}
        {!elements.length && !preview && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white px-3 py-1.5 text-sm text-ink-3 shadow-xs">
            {readOnly ? "白板暂无内容" : "选择画笔、便签或图形开始绘制"}
          </span>
        )}
      </div>

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-2 py-1">
        <div className="flex flex-wrap items-center gap-1">
          {!readOnly && (!active || "color" in active) && WHITEBOARD_COLORS.map((value) => {
            const current = active && "color" in active ? active.color : color;
            return (
              <button
                key={value}
                type="button"
                aria-label={palette[value].label}
                aria-pressed={current === value}
                className={cn("size-5 rounded-full border", current === value ? "ring-2 ring-slate-500 ring-offset-1" : "opacity-80 hover:opacity-100")}
                style={{ backgroundColor: palette[value].fill, borderColor: palette[value].stroke }}
                onMouseDown={keepEditorFocus}
                onClick={() => {
                  setColor(value);
                  const currentElements = latestElements.current;
                  const target = active ? currentElements.find((entry) => entry.id === active.id) : null;
                  if (target && "color" in target && target.color !== value) {
                    commit(replaceElement(currentElements, { ...target, color: value }));
                  }
                }}
              />
            );
          })}
          {!readOnly && (!active || "text" in active) && (
            <>
              <span className="mx-1 h-4 shrink-0 border-l border-line" />
              {horizontalAligns.map(({ value, label, icon: Icon }) => {
                const current = active && "text" in active ? resolveWhiteboardTextAlign(active) : textAlign;
                return (
                  <IconButton
                    key={value}
                    title={label}
                    aria-label={label}
                    aria-pressed={current === value}
                    className={cn(current === value && "bg-accent-soft text-accent")}
                    onMouseDown={keepEditorFocus}
                    onClick={() => {
                      setTextAlign(value);
                      const currentElements = latestElements.current;
                      const target = active ? currentElements.find((entry) => entry.id === active.id) : null;
                      if (target && "text" in target && resolveWhiteboardTextAlign(target) !== value) {
                        commit(replaceElement(currentElements, { ...target, textAlign: value }));
                      }
                    }}
                  >
                    <Icon className="size-3.5" />
                  </IconButton>
                );
              })}
            </>
          )}
          {!readOnly && (!active || ("text" in active && active.type !== "arrow")) && (
            <>
              <span className="mx-1 h-4 shrink-0 border-l border-line" />
              {verticalAligns.map(({ value, label, icon: Icon }) => {
                const current = active ? resolveWhiteboardVerticalAlign(active) : verticalAlign;
                return (
                  <IconButton
                    key={value}
                    title={label}
                    aria-label={label}
                    aria-pressed={current === value}
                    className={cn(current === value && "bg-accent-soft text-accent")}
                    onMouseDown={keepEditorFocus}
                    onClick={() => {
                      setVerticalAlign(value);
                      const currentElements = latestElements.current;
                      const target = active ? currentElements.find((entry) => entry.id === active.id) : null;
                      if (target && "text" in target && target.type !== "arrow" && resolveWhiteboardVerticalAlign(target) !== value) {
                        commit(replaceElement(currentElements, { ...target, verticalAlign: value }));
                      }
                    }}
                  >
                    <Icon className="size-3.5" />
                  </IconButton>
                );
              })}
            </>
          )}
          {active && "text" in active && !readOnly && (
            <IconButton
              title={editingId === active.id ? "完成文字编辑 (Ctrl+Enter)" : "编辑文字 (Enter)"}
              aria-label="编辑文字"
              aria-pressed={editingId === active.id}
              className={cn(editingId === active.id && "bg-accent-soft text-accent")}
              onMouseDown={keepEditorFocus}
              onClick={() => {
                if (editingId === active.id) commitEditor(true);
                else openItem(active);
              }}
            >
              <Type className="size-4" />
            </IconButton>
          )}
          {active?.type === "page" && refById.has(active.documentId) && (
            <Button variant="ghost" size="sm" onClick={() => openItem(active)}><ExternalLink className="size-3.5" />打开文档</Button>
          )}
          {active && !readOnly && (
            <IconButton
              title="删除元素"
              aria-label="删除元素"
              onClick={() => {
                cancelEditor();
                commit(removeElement(latestElements.current, active.id));
                setSelection(null);
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton title="缩小" aria-label="缩小" onMouseDown={keepEditorFocus} onClick={() => zoom(1 / 1.25)}><Minus className="size-4" /></IconButton>
          <span className="w-12 text-center text-xs tabular-nums text-ink-2">{Math.round(viewport.scale * 100)}%</span>
          <IconButton title="放大" aria-label="放大" onMouseDown={keepEditorFocus} onClick={() => zoom(1.25)}><Plus className="size-4" /></IconButton>
          <IconButton title="适合画布" aria-label="适合画布" onMouseDown={keepEditorFocus} onClick={() => setView(fitView(elements, size.width, size.height))}><Maximize2 className="size-4" /></IconButton>
          <IconButton
            title="导出 PNG"
            aria-label="导出 PNG"
            onClick={async () => {
              commitEditor();
              await Promise.allSettled([...images.current.values()].map((image) => image.decode()));
              exportWhiteboardPng(latestElements.current, refById, images.current, title);
            }}
          >
            <ImageDown className="size-4" />
          </IconButton>
        </div>
      </div>

      <PagePickerDialog
        open={picker}
        onOpenChange={setPicker}
        excludeId={boardId}
        onPick={(page) => {
          const item = { id: randomId(), type: "page", ...insertNearCenter(216, 66), width: 216, height: 66, documentId: page.id } as const;
          setNewReferences((previous) => [...previous.filter((ref) => ref.id !== page.id), page]);
          commit([...latestElements.current, item]);
          setSelection(item.id);
          setTool("select");
          setPicker(false);
        }}
      />
    </div>
  );
}
