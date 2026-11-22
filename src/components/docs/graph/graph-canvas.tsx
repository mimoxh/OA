"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  bounds,
  createSimulation,
  nodeAt,
  reheat,
  settle,
  stepSimulation,
  type Point,
  type Simulation,
} from "@/lib/docs/graph/layout";
import {
  labelZoom,
  nodeColor,
  nodeRadius,
  nodeTitle,
  truncateLabel,
  type GraphColorMode,
  type GraphViewModel,
} from "@/lib/docs/graph/model";

export interface GraphCanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
}

interface Props {
  view: GraphViewModel;
  colorMode: GraphColorMode;
  selectedId: string | null;
  currentId: string | null;
  label: string;
  compact?: boolean;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
}

const MIN_ZOOM = 0.06;
const MAX_ZOOM = 4;
const LABEL_CAP = 320;
const ARROW_EDGE_CAP = 1500;

const FALLBACK_COLORS = {
  text: "#37352f",
  muted: "#787774",
  faint: "#a5a29c",
  line: "#d3d1cb",
  accent: "#2383e2",
  bg: "#ffffff",
};
type Colors = typeof FALLBACK_COLORS;

function readColors(element: Element): Colors {
  const style = getComputedStyle(element);
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    text: pick("--color-ink", FALLBACK_COLORS.text),
    muted: pick("--color-ink-2", FALLBACK_COLORS.muted),
    faint: pick("--color-ink-3", FALLBACK_COLORS.faint),
    line: pick("--color-line-strong", FALLBACK_COLORS.line),
    accent: pick("--color-accent", FALLBACK_COLORS.accent),
    bg: pick("--color-canvas", FALLBACK_COLORS.bg),
  };
}

const radiusScale = (zoom: number) => Math.max(0.55, Math.min(1.5, Math.sqrt(zoom)));
const edgeWidth = (count: number) => (count >= 4 ? 2.4 : count >= 2 ? 1.6 : 1);

/**
 * 基于 Canvas 2D 的高性能力导向图画布。
 * 逐帧状态保存在 ref 中，仅在 view / selectedId / colorMode 变更时触发重绘，布局静止后自动停止 rAF。
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);

  const stateRef = useRef({
    sim: null as Simulation | null,
    view: props.view,
    positions: new Map<string, Point>(),
    order: [] as number[],
    zoom: 1,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    dpr: 1,
    userMoved: false,
    hover: -1,
    frame: 0,
    onScreen: true,
    colors: FALLBACK_COLORS,
    font: "12px sans-serif",
    drag: null as null | {
      kind: "node" | "pan";
      index: number;
      startX: number;
      startY: number;
      moved: boolean;
      pointerId: number;
    },
    pointers: new Map<number, Point>(),
    pinch: null as null | { distance: number; zoom: number },
  });

  useEffect(() => {
    propsRef.current = props;
  });

  const fitNow = useCallback(() => {
    const state = stateRef.current;
    const sim = state.sim;
    const box = sim && bounds(sim);
    if (!sim || !box || !state.width || !state.height) return;
    const pad = propsRef.current.compact ? 40 : 64;
    const width = Math.max(box.maxX - box.minX, 1);
    const height = Math.max(box.maxY - box.minY, 1);
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(sim.count < 2 ? 1.2 : 1.8, (state.width - pad * 2) / width, (state.height - pad * 2) / height),
    );
    state.zoom = zoom;
    state.x = state.width / 2 - ((box.minX + box.maxX) / 2) * zoom;
    state.y = state.height / 2 - ((box.minY + box.maxY) / 2) * zoom;
  }, []);

  const draw = useCallback(() => {
    const state = stateRef.current;
    const canvas = canvasRef.current;
    const sim = state.sim;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !sim || !state.width) return;
    const { view, zoom, x: tx, y: ty, width, height, colors } = state;
    const { selectedId, currentId, colorMode } = propsRef.current;
    const scale = radiusScale(zoom);

    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const selected = selectedId ? (view.index.get(selectedId) ?? -1) : -1;
    const current = currentId ? (view.index.get(currentId) ?? -1) : -1;
    const centre = state.hover >= 0 ? state.hover : selected;
    const lit = new Uint8Array(sim.count);
    if (centre >= 0 && centre < sim.count) {
      lit[centre] = 1;
      for (const other of view.neighbors[centre] ?? []) lit[other] = 1;
    }
    const dimmed = state.hover >= 0;

    const px = (index: number) => sim.x[index]! * zoom + tx;
    const py = (index: number) => sim.y[index]! * zoom + ty;
    const outside = (ax: number, ay: number, bx: number, by: number) =>
      (ax < 0 && bx < 0) || (ax > width && bx > width) || (ay < 0 && by < 0) || (ay > height && by > height);

    // 1. 边分桶绘制（减少 Canvas stroke 次数）
    const isLit = (link: { source: number; target: number }) =>
      centre >= 0 && (link.source === centre || link.target === centre);
    const buckets: number[][] = [[], [], [], [], [], []];
    for (const link of view.links) {
      const ax = px(link.source);
      const ay = py(link.source);
      const bx = px(link.target);
      const by = py(link.target);
      if (outside(ax, ay, bx, by)) continue;
      const tree = link.kind === "tree";
      const weight = edgeWidth(link.forward + link.backward);
      const bucketIdx = isLit(link)
        ? tree
          ? 4
          : 5
        : tree
          ? 0
          : weight === 1
            ? 1
            : weight === 1.6
              ? 2
              : 3;
      buckets[bucketIdx]!.push(ax, ay, bx, by);
    }

    const stroke = (bucket: number, style: string, lineWidth: number, alpha: number, dash: number[]) => {
      const points = buckets[bucket]!;
      if (!points.length) return;
      context.beginPath();
      for (let i = 0; i < points.length; i += 4) {
        context.moveTo(points[i]!, points[i + 1]!);
        context.lineTo(points[i + 2]!, points[i + 3]!);
      }
      context.setLineDash(dash);
      context.globalAlpha = alpha;
      context.strokeStyle = style;
      context.lineWidth = lineWidth;
      context.stroke();
    };

    stroke(0, colors.faint, 1, dimmed ? 0.14 : 0.65, [3, 4]);
    [1, 1.6, 2.4].forEach((lineWidth, idx) => stroke(idx + 1, colors.line, lineWidth, dimmed ? 0.16 : 0.95, []));
    stroke(4, colors.accent, 1.2, 0.8, [3, 4]);
    stroke(5, colors.accent, 1.8, 0.95, []);
    context.setLineDash([]);

    const plainEdges = (buckets[1]!.length + buckets[2]!.length + buckets[3]!.length) / 4;

    // 2. 方向箭头
    const heads = (onlyLit: boolean, style: string, alpha: number) => {
      context.beginPath();
      const size = 5.5 * scale;
      for (const link of view.links) {
        if (link.kind !== "link" || (onlyLit && !isLit(link))) continue;
        const ax = px(link.source);
        const ay = py(link.source);
        const bx = px(link.target);
        const by = py(link.target);
        if (outside(ax, ay, bx, by)) continue;
        const length = Math.hypot(bx - ax, by - ay);
        if (length < size * 3) continue;
        const ux = (bx - ax) / length;
        const uy = (by - ay) / length;
        const head = (tipX: number, tipY: number, dx: number, dy: number) => {
          context.moveTo(tipX, tipY);
          context.lineTo(tipX - dx * size - dy * size * 0.5, tipY - dy * size + dx * size * 0.5);
          context.lineTo(tipX - dx * size + dy * size * 0.5, tipY - dy * size - dx * size * 0.5);
          context.closePath();
        };
        if (link.forward > 0) {
          const r = nodeRadius(view.nodes[link.target]!.degree) * scale + 1.5;
          head(bx - ux * r, by - uy * r, ux, uy);
        }
        if (link.backward > 0) {
          const r = nodeRadius(view.nodes[link.source]!.degree) * scale + 1.5;
          head(ax + ux * r, ay + uy * r, -ux, -uy);
        }
      }
      context.globalAlpha = alpha;
      context.fillStyle = style;
      context.fill();
    };
    if (!dimmed && zoom >= 0.55 && plainEdges <= ARROW_EDGE_CAP) heads(false, colors.faint, 0.9);
    if (centre >= 0) heads(true, colors.accent, 1);

    // 3. 节点按填充色合批绘制
    const fills = new Map<string, number[]>();
    for (let i = 0; i < sim.count; i++) {
      const node = view.nodes[i]!;
      const cx = px(i);
      const cy = py(i);
      const radius = nodeRadius(node.degree) * scale;
      if (cx < -radius || cy < -radius || cx > width + radius || cy > height + radius) continue;
      const color = i === current ? colors.accent : (nodeColor(node, colorMode) ?? colors.muted);
      const key = `${dimmed && !lit[i] ? "d" : "n"}${color}`;
      const group = fills.get(key);
      if (group) group.push(i);
      else fills.set(key, [i]);
    }
    for (const [key, group] of fills) {
      context.globalAlpha = key[0] === "d" ? 0.2 : 1;
      context.fillStyle = key.slice(1);
      context.beginPath();
      for (const i of group) {
        const cx = px(i);
        const cy = py(i);
        const radius = nodeRadius(view.nodes[i]!.degree) * scale;
        context.moveTo(cx + radius, cy);
        context.arc(cx, cy, radius, 0, Math.PI * 2);
      }
      context.fill();
    }

    // 选中 / 当前页 / 悬停外环
    context.globalAlpha = 1;
    context.lineWidth = 2;
    context.strokeStyle = colors.accent;
    for (const i of new Set([selected, current, state.hover])) {
      if (i < 0 || i >= sim.count) continue;
      context.beginPath();
      context.arc(px(i), py(i), nodeRadius(view.nodes[i]!.degree) * scale + 3.5, 0, Math.PI * 2);
      context.stroke();
    }

    // 4. 按度数优先绘制标签（网格去重防重叠）
    context.font = state.font;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.strokeStyle = colors.bg;
    context.fillStyle = colors.text;
    let labels = 0;
    const taken = new Set<number>();
    for (const i of state.order) {
      if (labels >= LABEL_CAP) break;
      const node = view.nodes[i]!;
      const must = i === selected || i === current || i === state.hover;
      const forced = must || (dimmed && lit[i] === 1);
      const threshold = labelZoom(node.degree);
      if (!forced && (zoom < threshold || (dimmed && !lit[i]))) continue;
      const cx = px(i);
      const cy = py(i);
      if (cx < -80 || cy < -20 || cx > width + 80 || cy > height + 20) continue;
      const cell = Math.floor(cx / 96) * 4096 + Math.floor(cy / 18);
      if (taken.has(cell) && !must) continue;
      taken.add(cell);
      context.globalAlpha = forced ? 1 : Math.min(1, (zoom - threshold) / 0.12 + 0.25);
      const text = truncateLabel(`${node.icon ? `${node.icon} ` : ""}${nodeTitle(node)}`);
      const top = cy + nodeRadius(node.degree) * scale + 5;
      context.strokeText(text, cx, top);
      context.fillText(text, cx, top);
      labels++;
    }
    context.globalAlpha = 1;
  }, []);

  const scheduleRef = useRef<() => void>(() => {});
  const schedule = useCallback(() => {
    const state = stateRef.current;
    if (state.frame || typeof requestAnimationFrame !== "function") return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      const sim = state.sim;
      if (!sim) return;
      const paused = document.hidden || !state.onScreen;
      let active = false;
      if (!paused) {
        const started = performance.now();
        let steps = 0;
        do {
          active = stepSimulation(sim);
          steps++;
        } while (active && steps < 4 && performance.now() - started < 7);
        if (active && !state.userMoved) fitNow();
      }
      draw();
      if (active) scheduleRef.current();
    });
  }, [draw, fitNow]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  const zoomAt = useCallback(
    (cx: number, cy: number, next: number) => {
      const state = stateRef.current;
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      state.x = cx - ((cx - state.x) / state.zoom) * zoom;
      state.y = cy - ((cy - state.y) / state.zoom) * zoom;
      state.zoom = zoom;
      state.userMoved = true;
      schedule();
    },
    [schedule],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        stateRef.current.userMoved = false;
        fitNow();
        schedule();
      },
      zoomBy: (factor) => {
        const state = stateRef.current;
        zoomAt(state.width / 2, state.height / 2, state.zoom * factor);
      },
    }),
    [fitNow, schedule, zoomAt],
  );

  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const hit = (point: Point, slack = 4): number => {
    const state = stateRef.current;
    const sim = state.sim;
    if (!sim) return -1;
    const scale = radiusScale(state.zoom);
    return nodeAt(
      sim,
      (point.x - state.x) / state.zoom,
      (point.y - state.y) / state.zoom,
      (index) => (nodeRadius(state.view.nodes[index]!.degree) * scale) / state.zoom,
      slack / state.zoom,
    );
  };

  // 重建布局（尽量保留已有节点位置，减少跳动）
  useEffect(() => {
    const state = stateRef.current;
    const prev = state.sim;
    if (prev) {
      state.positions.clear();
      for (let i = 0; i < prev.count; i++) {
        const node = state.view.nodes[i];
        if (node) state.positions.set(node.id, { x: prev.x[i]!, y: prev.y[i]! });
      }
    }
    const view = props.view;
    const sim = createSimulation(
      view.nodes.map((n) => n.id),
      view.links.map((link) => ({
        source: link.source,
        target: link.target,
        weight: link.kind === "tree" ? 1 : link.forward + link.backward,
      })),
      state.positions,
    );
    if (sim.count <= 120) settle(sim, 300);
    state.sim = sim;
    state.view = view;
    state.hover = -1;
    state.drag = null;
    state.order = view.nodes
      .map((_, index) => index)
      .sort((a, b) => view.nodes[b]!.degree - view.nodes[a]!.degree || a - b);
    if (!state.userMoved) fitNow();
    schedule();
  }, [props.view, fitNow, schedule]);

  useEffect(() => {
    schedule();
  }, [props.selectedId, props.currentId, props.colorMode, schedule]);

  useEffect(() => {
    const state = stateRef.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const restyle = () => {
      state.colors = readColors(canvas);
      state.font = `${propsRef.current.compact ? 11 : 12}px ${getComputedStyle(canvas).fontFamily || "sans-serif"}`;
      schedule();
    };
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!rect.width || !rect.height) return;
      const first = !state.width;
      state.width = rect.width;
      state.height = rect.height;
      state.dpr = dpr;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (first || !state.userMoved) fitNow();
      draw();
    };
    restyle();
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(wrap);
    const visibility =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            state.onScreen = entries.some((entry) => entry.isIntersecting);
            if (state.onScreen) schedule();
          })
        : null;
    visibility?.observe(canvas);
    const resume = () => {
      if (!document.hidden) schedule();
    };
    document.addEventListener("visibilitychange", resume);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event);
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAt(point.x, point.y, state.zoom * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0016)));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer?.disconnect();
      visibility?.disconnect();
      document.removeEventListener("visibilitychange", resume);
      canvas.removeEventListener("wheel", wheel);
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, [draw, fitNow, schedule, zoomAt]);

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = localPoint(event);
    state.pointers.set(event.pointerId, point);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件不支持捕获
    }
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()] as [Point, Point];
      if (state.drag?.kind === "node" && state.sim) {
        state.sim.fixed[state.drag.index] = 0;
        state.sim.alphaTarget = 0;
      }
      state.drag = null;
      state.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: state.zoom };
      return;
    }
    const index = hit(point, event.pointerType === "mouse" ? 4 : 12);
    state.drag = {
      kind: index >= 0 ? "node" : "pan",
      index,
      startX: point.x,
      startY: point.y,
      moved: false,
      pointerId: event.pointerId,
    };
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    const point = localPoint(event);
    const sim = state.sim;
    const last = state.pointers.get(event.pointerId);
    if (last) state.pointers.set(event.pointerId, point);
    if (state.pinch && state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()] as [Point, Point];
      zoomAt(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        (state.pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) || 1)) / state.pinch.distance,
      );
      return;
    }
    const drag = state.drag;
    if (drag && drag.pointerId === event.pointerId && last && sim) {
      if (!drag.moved && Math.hypot(point.x - drag.startX, point.y - drag.startY) < 4) return;
      drag.moved = true;
      if (drag.kind === "node") {
        sim.fixed[drag.index] = 1;
        sim.x[drag.index] = (point.x - state.x) / state.zoom;
        sim.y[drag.index] = (point.y - state.y) / state.zoom;
        sim.alphaTarget = 0.25;
        reheat(sim, 0.25);
        state.userMoved = true;
      } else {
        state.x += point.x - last.x;
        state.y += point.y - last.y;
        state.userMoved = true;
      }
      event.currentTarget.style.cursor = "grabbing";
      schedule();
      return;
    }
    if (event.pointerType !== "mouse") return;
    const hover = hit(point);
    if (hover !== state.hover) {
      state.hover = hover;
      event.currentTarget.style.cursor = hover >= 0 ? "pointer" : "grab";
      schedule();
    }
  };

  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    state.pointers.delete(event.pointerId);
    if (state.pinch) {
      if (state.pointers.size < 2) state.pinch = null;
      return;
    }
    const drag = state.drag;
    const sim = state.sim;
    state.drag = null;
    if (!drag || drag.pointerId !== event.pointerId || !sim) return;
    if (drag.kind === "node") {
      sim.fixed[drag.index] = 0;
      sim.alphaTarget = 0;
    }
    event.currentTarget.style.cursor = drag.kind === "node" ? "pointer" : "grab";
    if (!drag.moved && event.type === "pointerup") {
      propsRef.current.onSelect(drag.kind === "node" ? (state.view.nodes[drag.index]?.id ?? null) : null);
    }
    schedule();
  };

  const keyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const pan = (dx: number, dy: number) => {
      state.x += dx;
      state.y += dy;
      state.userMoved = true;
      schedule();
    };
    const selected = propsRef.current.selectedId;
    if (event.key === "Enter" && selected) propsRef.current.onOpen(selected);
    else if (event.key === "+" || event.key === "=") zoomAt(state.width / 2, state.height / 2, state.zoom * 1.25);
    else if (event.key === "-") zoomAt(state.width / 2, state.height / 2, state.zoom / 1.25);
    else if (event.key === "0") {
      state.userMoved = false;
      fitNow();
      schedule();
    } else if (event.key === "ArrowLeft") pan(48, 0);
    else if (event.key === "ArrowRight") pan(-48, 0);
    else if (event.key === "ArrowUp") pan(0, 48);
    else if (event.key === "ArrowDown") pan(0, -48);
    else return;
    event.preventDefault();
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label={props.label}
        className="block h-full w-full cursor-grab touch-none focus:outline-none"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onPointerLeave={() => {
          const state = stateRef.current;
          if (state.hover >= 0 && !state.drag) {
            state.hover = -1;
            schedule();
          }
        }}
        onDoubleClick={(event) => {
          const index = hit(localPoint(event));
          if (index >= 0) props.onOpen(stateRef.current.view.nodes[index]!.id);
        }}
        onKeyDown={keyDown}
      />
    </div>
  );
});
