import {
  WHITEBOARD_MAX_COORDINATE,
  type WhiteboardBox,
  type WhiteboardColor,
  type WhiteboardElement,
  type WhiteboardPoint,
} from "./content";

export type WhiteboardView = WhiteboardPoint & { scale: number };
export type FigureType = Extract<WhiteboardElement, { text: string; width: number }>["type"];
export type WhiteboardTool = FigureType | "select" | "pan" | "pen" | "arrow" | "erase";

type Arrow = Extract<WhiteboardElement, { type: "arrow" }>;

export const palette: Record<WhiteboardColor, { label: string; fill: string; stroke: string }> = {
  gray: { label: "灰色", fill: "#eef1f5", stroke: "#34445a" },
  blue: { label: "蓝色", fill: "#dbeafe", stroke: "#2563eb" },
  teal: { label: "青色", fill: "#ccfbf1", stroke: "#0f766e" },
  yellow: { label: "黄色", fill: "#fef3c7", stroke: "#a16207" },
  pink: { label: "粉色", fill: "#fce7f3", stroke: "#be185d" },
  purple: { label: "紫色", fill: "#ede9fe", stroke: "#6d28d9" },
};

const defaultSizes: Record<FigureType, readonly [number, number]> = {
  rectangle: [160, 96],
  ellipse: [144, 96],
  diamond: [144, 112],
  note: [176, 146],
  text: [216, 70],
  frame: [380, 250],
};

export function clampPoint(point: WhiteboardPoint): WhiteboardPoint {
  return {
    x: Math.max(-WHITEBOARD_MAX_COORDINATE, Math.min(WHITEBOARD_MAX_COORDINATE, point.x)),
    y: Math.max(-WHITEBOARD_MAX_COORDINATE, Math.min(WHITEBOARD_MAX_COORDINATE, point.y)),
  };
}

function boxBetween(a: WhiteboardPoint, b: WhiteboardPoint): WhiteboardBox {
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.min(WHITEBOARD_MAX_COORDINATE, Math.max(1, Math.abs(a.x - b.x))),
    height: Math.min(WHITEBOARD_MAX_COORDINATE, Math.max(1, Math.abs(a.y - b.y))),
  };
}

export function makeFigure(
  id: string, type: FigureType, start: WhiteboardPoint, end: WhiteboardPoint, color: WhiteboardColor,
): WhiteboardElement {
  const [width, height] = defaultSizes[type];
  const box = Math.hypot(end.x - start.x, end.y - start.y) < 6
    ? { ...start, width, height }
    : boxBetween(start, end);
  return { id, type, color, ...box, text: type === "frame" ? "框架" : "" };
}

export function makeStroke(id: string, points: WhiteboardPoint[], color: WhiteboardColor): WhiteboardElement {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const box = boxBetween({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) });
  return {
    id, type: "pen", color, ...box,
    points: points.map((p) => ({
      x: Math.min(1, (p.x - box.x) / box.width),
      y: Math.min(1, (p.y - box.y) / box.height),
    })),
  };
}

function center(box: WhiteboardBox): WhiteboardPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function edge(box: WhiteboardBox, toward: WhiteboardPoint): WhiteboardPoint {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const t = Math.max(Math.abs(dx) / box.width, Math.abs(dy) / box.height) * 2;
  return t ? { x: c.x + dx / t, y: c.y + dy / t } : c;
}

export function arrowPoints(element: Arrow, byId: Map<string, WhiteboardElement>): [WhiteboardPoint, WhiteboardPoint] {
  const from = element.from.elementId && byId.get(element.from.elementId);
  const to = element.to.elementId && byId.get(element.to.elementId);
  const a = from && from.type !== "arrow" ? from : null;
  const b = to && to.type !== "arrow" ? to : null;
  return [
    a ? edge(a, b ? center(b) : element.to) : element.from,
    b ? edge(b, a ? center(a) : element.from) : element.to,
  ];
}

export function elementBounds(element: WhiteboardElement, byId: Map<string, WhiteboardElement>): WhiteboardBox {
  return element.type === "arrow" ? boxBetween(...arrowPoints(element, byId)) : element;
}

export function sceneBounds(elements: WhiteboardElement[]) {
  if (!elements.length) return null;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const boxes = elements.map((e) => elementBounds(e, byId));
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x, y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

export function offsetElement(element: WhiteboardElement, dx: number, dy: number, items: WhiteboardElement[]): WhiteboardElement {
  if (element.type === "arrow") {
    const [from, to] = arrowPoints(element, new Map(items.map((item) => [item.id, item])));
    const offset = (p: WhiteboardPoint) => clampPoint({ x: p.x + dx, y: p.y + dy });
    return { ...element, from: offset(from), to: offset(to) };
  }
  return { ...element, ...clampPoint({ x: element.x + dx, y: element.y + dy }) };
}

export function resizeElement(element: Exclude<WhiteboardElement, Arrow>, point: WhiteboardPoint): WhiteboardElement {
  return {
    ...element,
    width: Math.max(18, Math.min(WHITEBOARD_MAX_COORDINATE, point.x - element.x)),
    height: Math.max(18, Math.min(WHITEBOARD_MAX_COORDINATE, point.y - element.y)),
  };
}

function distanceToSegment(p: WhiteboardPoint, a: WhiteboardPoint, b: WhiteboardPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

export function hitElement(elements: WhiteboardElement[], at: WhiteboardPoint, tolerance: number, bindable = false) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const item = elements[index];
    if (item.type === "arrow") {
      if (!bindable && distanceToSegment(at, ...arrowPoints(item, byId)) <= tolerance) return item;
      continue;
    }
    if (bindable && item.type === "pen") continue;
    const { x, y, width, height } = item;
    if (at.x < x - tolerance || at.x > x + width + tolerance || at.y < y - tolerance || at.y > y + height + tolerance) continue;
    if (item.type === "frame") {
      if (at.x > x + tolerance && at.x < x + width - tolerance && at.y > y + 30 && at.y < y + height - tolerance) continue;
    } else if (item.type === "pen") {
      const points = item.points.map((p) => ({ x: x + p.x * width, y: y + p.y * height }));
      if (!points.some((p, i) => distanceToSegment(at, points[Math.max(0, i - 1)], p) <= tolerance)) continue;
    }
    return item;
  }
  return null;
}

/** 删除元素后保持原连线位置，同时断开已不存在的绑定。 */
export function removeElement(elements: WhiteboardElement[], id: string) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements.filter((e) => e.id !== id).map((e) => {
    if (e.type !== "arrow" || (e.from.elementId !== id && e.to.elementId !== id)) return e;
    const [a, b] = arrowPoints(e, byId);
    return { ...e, from: e.from.elementId === id ? clampPoint(a) : e.from, to: e.to.elementId === id ? clampPoint(b) : e.to };
  });
}

export function fitView(elements: WhiteboardElement[], width: number, height: number): WhiteboardView {
  const box = sceneBounds(elements);
  if (!box) return { x: 0, y: 0, scale: 1 };
  const scale = Math.max(0.02, Math.min(1, (width - 64) / box.width, (height - 64) / box.height));
  return {
    x: (width - box.width * scale) / 2 - box.x * scale,
    y: (height - box.height * scale) / 2 - box.y * scale,
    scale,
  };
}
