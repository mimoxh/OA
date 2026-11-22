import type { WhiteboardElement, WhiteboardReference } from "./content";
import { arrowPoints, elementBounds, palette, sceneBounds, type WhiteboardView } from "./geometry";

export type WhiteboardImages = Map<string, HTMLImageElement>;
export type WhiteboardReferences = Map<string, WhiteboardReference>;

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number, lineHeight: number) {
  if (!text || width <= 0 || height < lineHeight) return;
  let line = "";
  let offset = 0;
  for (const char of text) {
    if (char === "\n" || (line && ctx.measureText(line + char).width > width)) {
      ctx.fillText(line, x, y + offset, width);
      line = char === "\n" ? "" : char;
      offset += lineHeight;
      if (offset + lineHeight > height) return;
    } else {
      line += char;
    }
  }
  if (line) ctx.fillText(line, x, y + offset, width);
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  item: WhiteboardElement,
  byId: Map<string, WhiteboardElement>,
  references: WhiteboardReferences,
  images: WhiteboardImages,
) {
  const colors = "color" in item ? palette[item.color] : palette.gray;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = colors.stroke;
  ctx.fillStyle = colors.fill;
  ctx.textBaseline = "top";

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
    ctx.font = "14px system-ui";
    ctx.fillStyle = colors.stroke;
    ctx.fillText(item.text, (a.x + b.x) / 2 + 5, (a.y + b.y) / 2 - 22, 200);
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
      ctx.fillText(image?.complete ? "图片不可用" : "正在加载图片", x + 12, y + 12, Math.max(1, width - 24));
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
    drawText(ctx, doc ? `${doc.icon || "📄"}  ${doc.title || "无标题"}` : "页面不可用", x + 12, y + 12, width - 24, height - 20, 20);
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

  const insetX = item.type === "diamond" ? width / 4 : 12;
  const insetY = item.type === "diamond" ? height / 4 : 11;
  ctx.font = item.type === "text" ? "17px system-ui" : "15px system-ui";
  ctx.fillStyle = colors.stroke;
  drawText(ctx, item.text, x + insetX, y + insetY, width - 2 * insetX, height - 2 * insetY, 21);
}

type PaintOptions = {
  width: number;
  height: number;
  view: WhiteboardView;
  references: WhiteboardReferences;
  images: WhiteboardImages;
  grid?: boolean;
  selectedId?: string | null;
  showResizeHandle?: boolean;
};

export function paintWhiteboard(ctx: CanvasRenderingContext2D, elements: WhiteboardElement[], options: PaintOptions) {
  const { width, height, view, references, images, grid, selectedId, showResizeHandle } = options;
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
    drawElement(ctx, item, byId, references, images);
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
