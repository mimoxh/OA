import {
  DEFAULT_WHITEBOARD_TEXT_ALIGN,
  DEFAULT_WHITEBOARD_VERTICAL_ALIGN,
  resolveWhiteboardTextAlign,
  resolveWhiteboardVerticalAlign,
  type WhiteboardElement,
  type WhiteboardReference,
  type WhiteboardTextAlign,
  type WhiteboardTextElement,
  type WhiteboardVerticalAlign,
} from "./content";
import { arrowPoints, elementBounds, palette, sceneBounds, type WhiteboardView } from "./geometry";

const BOX_TEXT_INSET_X = 12;
const BOX_TEXT_INSET_Y = 11;
const BOX_TEXT_LINE_HEIGHT = 21;
const ARROW_LABEL_MAX_WIDTH = 200;
const ARROW_LABEL_LINE_HEIGHT = 18;
const ARROW_LABEL_OFFSET_X = 5;
const ARROW_LABEL_OFFSET_Y = 6;
const ARROW_EDITOR_LINES = 4;

export type WhiteboardImages = Map<string, HTMLImageElement>;
export type WhiteboardReferences = Map<string, WhiteboardReference>;
export type TextLayoutLine = { text: string; x: number; y: number };
export type TextLayoutOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  lineHeight: number;
  textAlign?: WhiteboardTextAlign;
  verticalAlign?: WhiteboardVerticalAlign;
};
export type WhiteboardTextEditorLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  textAlign: WhiteboardTextAlign;
  verticalAlign: WhiteboardVerticalAlign;
  color: string;
  isArrow: boolean;
};

export function wrapWhiteboardText(
  text: string,
  maxWidth: number,
  measureWidth: (segment: string) => number,
): string[] {
  if (!text || maxWidth <= 0) return [];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const char of paragraph) {
      if (line && measureWidth(line + char) > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line += char;
      }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

export function layoutWhiteboardText(
  text: string,
  options: TextLayoutOptions,
  measureWidth: (segment: string) => number,
): { textAlign: WhiteboardTextAlign; lines: TextLayoutLine[] } {
  const {
    x,
    y,
    width,
    height,
    lineHeight,
    textAlign = DEFAULT_WHITEBOARD_TEXT_ALIGN,
    verticalAlign = DEFAULT_WHITEBOARD_VERTICAL_ALIGN,
  } = options;
  if (!text || width <= 0 || height < lineHeight || lineHeight <= 0) {
    return { textAlign, lines: [] };
  }
  const maxLines = Math.floor(height / lineHeight);
  const wrapped = wrapWhiteboardText(text, width, measureWidth).slice(0, maxLines);
  if (!wrapped.length) return { textAlign, lines: [] };
  const anchorX = textAlign === "left" ? x : textAlign === "right" ? x + width : x + width / 2;
  const totalHeight = wrapped.length * lineHeight;
  const startY = verticalAlign === "top"
    ? y
    : verticalAlign === "bottom"
      ? y + height - totalHeight
      : y + (height - totalHeight) / 2;
  return {
    textAlign,
    lines: wrapped.map((line, index) => ({
      text: line,
      x: anchorX,
      y: startY + (index + 0.5) * lineHeight,
    })),
  };
}

export function layoutArrowLabel(
  text: string,
  midpoint: { x: number; y: number },
  textAlign: WhiteboardTextAlign,
  measureWidth: (segment: string) => number,
  maxWidth = ARROW_LABEL_MAX_WIDTH,
  lineHeight = ARROW_LABEL_LINE_HEIGHT,
): { textAlign: WhiteboardTextAlign; lines: TextLayoutLine[] } {
  const wrapped = wrapWhiteboardText(text, maxWidth, measureWidth);
  if (!wrapped.length) return { textAlign, lines: [] };
  const anchorX = textAlign === "left"
    ? midpoint.x + ARROW_LABEL_OFFSET_X
    : textAlign === "right"
      ? midpoint.x - ARROW_LABEL_OFFSET_X
      : midpoint.x;
  const startY = midpoint.y - ARROW_LABEL_OFFSET_Y - wrapped.length * lineHeight;
  return {
    textAlign,
    lines: wrapped.map((line, index) => ({
      text: line,
      x: anchorX,
      y: startY + (index + 0.5) * lineHeight,
    })),
  };
}

export function getWhiteboardTextEditorLayout(
  item: WhiteboardTextElement,
  byId: Map<string, WhiteboardElement>,
  view: WhiteboardView,
): WhiteboardTextEditorLayout {
  const color = palette[item.color].stroke;
  const textAlign = resolveWhiteboardTextAlign(item);

  if (item.type === "arrow") {
    const [a, b] = arrowPoints(item, byId);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const boardWidth = ARROW_LABEL_MAX_WIDTH;
    const boardHeight = ARROW_LABEL_LINE_HEIGHT * ARROW_EDITOR_LINES;
    const boardLeft = textAlign === "left"
      ? midpoint.x + ARROW_LABEL_OFFSET_X
      : textAlign === "right"
        ? midpoint.x - ARROW_LABEL_OFFSET_X - boardWidth
        : midpoint.x - boardWidth / 2;
    const boardTop = midpoint.y - ARROW_LABEL_OFFSET_Y - boardHeight;
    return {
      left: boardLeft * view.scale + view.x,
      top: boardTop * view.scale + view.y,
      width: boardWidth * view.scale,
      height: boardHeight * view.scale,
      fontSize: 14 * view.scale,
      lineHeight: ARROW_LABEL_LINE_HEIGHT * view.scale,
      textAlign,
      verticalAlign: "bottom",
      color,
      isArrow: true,
    };
  }

  const insetX = item.type === "diamond" ? item.width / 4 : BOX_TEXT_INSET_X;
  const insetY = item.type === "diamond" ? item.height / 4 : BOX_TEXT_INSET_Y;
  const boardLeft = item.x + insetX;
  const boardTop = item.y + insetY;
  const boardWidth = Math.max(1, item.width - 2 * insetX);
  const boardHeight = Math.max(1, item.height - 2 * insetY);
  const baseFontSize = item.type === "text" ? 17 : 15;
  return {
    left: boardLeft * view.scale + view.x,
    top: boardTop * view.scale + view.y,
    width: boardWidth * view.scale,
    height: boardHeight * view.scale,
    fontSize: baseFontSize * view.scale,
    lineHeight: BOX_TEXT_LINE_HEIGHT * view.scale,
    textAlign,
    verticalAlign: resolveWhiteboardVerticalAlign(item),
    color,
    isArrow: false,
  };
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  lineHeight: number,
  textAlign: WhiteboardTextAlign = DEFAULT_WHITEBOARD_TEXT_ALIGN,
  verticalAlign: WhiteboardVerticalAlign = DEFAULT_WHITEBOARD_VERTICAL_ALIGN,
) {
  const layout = layoutWhiteboardText(
    text,
    { x, y, width, height, lineHeight, textAlign, verticalAlign },
    (segment) => ctx.measureText(segment).width,
  );
  if (!layout.lines.length) return;
  ctx.textAlign = layout.textAlign;
  ctx.textBaseline = "middle";
  for (const line of layout.lines) {
    ctx.fillText(line.text, line.x, line.y, width);
  }
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  item: WhiteboardElement,
  byId: Map<string, WhiteboardElement>,
  references: WhiteboardReferences,
  images: WhiteboardImages,
  hideText = false,
) {
  const colors = "color" in item ? palette[item.color] : palette.gray;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = colors.stroke;
  ctx.fillStyle = colors.fill;
  ctx.textAlign = DEFAULT_WHITEBOARD_TEXT_ALIGN;
  ctx.textBaseline = "middle";

  if (item.type === "arrow") {
    const [a, b] = arrowPoints(item, byId);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.moveTo(b.x - 12 * Math.cos(angle - 0.48), b.y - 12 * Math.sin(angle - 0.48));
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x - 12 * Math.cos(angle + 0.48), b.y - 12 * Math.sin(angle + 0.48));
    ctx.stroke();
    if (item.text && !hideText) {
      ctx.font = "14px system-ui";
      ctx.fillStyle = colors.stroke;
      const layout = layoutArrowLabel(
        item.text,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        resolveWhiteboardTextAlign(item),
        (segment) => ctx.measureText(segment).width,
      );
      ctx.textAlign = layout.textAlign;
      ctx.textBaseline = "middle";
      for (const line of layout.lines) {
        ctx.fillText(line.text, line.x, line.y, ARROW_LABEL_MAX_WIDTH);
      }
    }
    return;
  }

  const { x, y, width, height } = item;
  if (item.type === "pen") {
    const [first] = item.points;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + first.x * width, y + first.y * height);
    if (item.points.length === 1) ctx.lineTo(x + first.x * width + 0.01, y + first.y * height);
    for (const p of item.points) ctx.lineTo(x + p.x * width, y + p.y * height);
    ctx.stroke();
    return;
  }

  if (item.type === "image") {
    const image = images.get(item.attachmentId);
    if (image?.naturalWidth) {
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
    } else {
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = palette.gray.stroke;
      ctx.font = "14px system-ui";
      const padX = width > 48 ? 12 : 4;
      const padY = height > 44 ? 12 : Math.max(0, (height - 20) / 2);
      drawText(
        ctx,
        image?.complete ? "图片不可用" : "正在加载图片",
        x + padX,
        y + padY,
        Math.max(1, width - 2 * padX),
        Math.max(20, height - 2 * padY),
        20,
        DEFAULT_WHITEBOARD_TEXT_ALIGN,
        DEFAULT_WHITEBOARD_VERTICAL_ALIGN,
      );
    }
    return;
  }

  if (item.type === "page") {
    const doc = references.get(item.documentId);
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 9);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.fill();
    ctx.stroke();
    ctx.font = "600 15px system-ui";
    ctx.fillStyle = doc ? "#1e3a8a" : "#64748b";
    drawText(
      ctx,
      doc ? `${doc.icon || "📄"}  ${doc.title || "无标题"}` : "页面不可用",
      x + 12,
      y + 10,
      width - 24,
      height - 20,
      20,
      DEFAULT_WHITEBOARD_TEXT_ALIGN,
      DEFAULT_WHITEBOARD_VERTICAL_ALIGN,
    );
    return;
  }

  ctx.beginPath();
  if (item.type === "ellipse") {
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI);
  } else if (item.type === "diamond") {
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width, y + height / 2);
    ctx.lineTo(x + width / 2, y + height);
    ctx.lineTo(x, y + height / 2);
    ctx.closePath();
  } else {
    ctx.roundRect(x, y, width, height, 6);
  }

  if (item.type === "frame") {
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (item.type === "note") {
    ctx.shadowColor = "#47556933";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fill();
    ctx.shadowColor = "transparent";
  } else if (item.type !== "text") {
    ctx.fill();
    ctx.stroke();
  }

  if (hideText) return;

  const insetX = item.type === "diamond" ? width / 4 : BOX_TEXT_INSET_X;
  const insetY = item.type === "diamond" ? height / 4 : BOX_TEXT_INSET_Y;
  ctx.font = item.type === "text" ? "17px system-ui" : "15px system-ui";
  ctx.fillStyle = colors.stroke;
  drawText(
    ctx,
    item.text,
    x + insetX,
    y + insetY,
    width - 2 * insetX,
    height - 2 * insetY,
    BOX_TEXT_LINE_HEIGHT,
    resolveWhiteboardTextAlign(item),
    resolveWhiteboardVerticalAlign(item),
  );
}

type PaintOptions = {
  width: number;
  height: number;
  view: WhiteboardView;
  references: WhiteboardReferences;
  images: WhiteboardImages;
  grid?: boolean;
  selectedId?: string | null;
  editingId?: string | null;
  showResizeHandle?: boolean;
};

export function paintWhiteboard(ctx: CanvasRenderingContext2D, elements: WhiteboardElement[], options: PaintOptions) {
  const { width, height, view, references, images, grid, selectedId, editingId, showResizeHandle } = options;
  ctx.fillStyle = grid ? "#f8fafc" : "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (grid) {
    const spacing = Math.max(16, Math.min(58, 24 * view.scale));
    const startX = (view.x % spacing + spacing) % spacing;
    const startY = (view.y % spacing + spacing) % spacing;
    ctx.fillStyle = "#cbd5e1";
    for (let x = startX; x < width; x += spacing) {
      for (let y = startY; y < height; y += spacing) ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  const byId = new Map(elements.map((e) => [e.id, e]));
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  for (const item of elements) {
    const bounds = elementBounds(item, byId);
    const left = bounds.x * view.scale + view.x;
    const top = bounds.y * view.scale + view.y;
    if (left > width + 50 || top > height + 50 || left + bounds.width * view.scale < -50 || top + bounds.height * view.scale < -50) continue;
    drawElement(ctx, item, byId, references, images, item.id === editingId);
  }

  const selected = selectedId ? byId.get(selectedId) : null;
  if (selected) {
    const { x, y, width: w, height: h } = elementBounds(selected, byId);
    const inset = 4 / view.scale;
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 1 / view.scale;
    ctx.setLineDash([4 / view.scale, 3 / view.scale]);
    ctx.strokeRect(x - inset, y - inset, w + 2 * inset, h + 2 * inset);
    if (showResizeHandle && selected.type !== "arrow") {
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + w - inset, y + h - inset, inset * 2, inset * 2);
      ctx.strokeRect(x + w - inset, y + h - inset, inset * 2, inset * 2);
    }
  }
  ctx.restore();
}

export function downloadWhiteboardFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function exportWhiteboardPng(
  items: WhiteboardElement[], references: WhiteboardReferences, images: WhiteboardImages, title: string,
) {
  const bounds = sceneBounds(items);
  const canvas = document.createElement("canvas");
  const border = 28;
  const scale = bounds ? Math.min(2, (4096 - 2 * border) / Math.max(bounds.width, bounds.height)) : 1;
  canvas.width = Math.ceil((bounds?.width ?? 480) * scale) + border * 2;
  canvas.height = Math.ceil((bounds?.height ?? 280) * scale) + border * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  paintWhiteboard(ctx, items, {
    width: canvas.width, height: canvas.height, references, images,
    view: { x: border - (bounds?.x ?? 0) * scale, y: border - (bounds?.y ?? 0) * scale, scale },
  });
  canvas.toBlob((blob) => {
    if (blob) downloadWhiteboardFile(blob, `${title || "白板"}.png`);
  }, "image/png");
}
