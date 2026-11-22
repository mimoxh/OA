import { buildQuadtree, repulsionAt } from "./quadtree";

/** 纯 TypeScript 力导向布局：Barnes–Hut 斥力 + 弹簧引力 + 中心重力，随 alpha 退火收敛 */
export interface SimLink {
  source: number;
  target: number;
  weight: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Simulation {
  count: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  fixed: Uint8Array;
  degree: Float32Array;
  links: SimLink[];
  alpha: number;
  alphaTarget: number;
}

export const layoutDefaults = {
  repulsion: 160,
  theta: 0.9,
  minDistance: 6,
  linkDistance: 72,
  linkStrength: 0.5,
  gravity: 0.08,
  friction: 0.55,
  alphaDecay: 0.025,
  alphaMin: 0.005,
  maxSpeed: 60,
};

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function mix(value: number): number {
  let t = (value + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 确定性初始坐标：相同 id 始终落在圆盘内的固定初始位置 */
export function seedPosition(id: string, count: number): Point {
  const seed = hash(id);
  const radius = 30 * Math.sqrt(Math.max(count, 1)) * Math.sqrt(mix(seed));
  const angle = mix(seed ^ 0x9e3779b9) * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** 创建力模拟；若传入 previous，则复用已有节点坐标并将新节点放在相邻节点附近 */
export function createSimulation(
  ids: readonly string[],
  links: readonly SimLink[],
  previous?: ReadonlyMap<string, Point>,
): Simulation {
  const count = ids.length;
  const sim: Simulation = {
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    fixed: new Uint8Array(count),
    degree: new Float32Array(count),
    links: links.filter((link) => link.source !== link.target && link.source < count && link.target < count),
    alpha: 1,
    alphaTarget: 0,
  };
  for (const link of sim.links) {
    sim.degree[link.source]!++;
    sim.degree[link.target]!++;
  }
  const placed = new Uint8Array(count);
  let known = 0;
  for (let i = 0; i < count; i++) {
    const point = previous?.get(ids[i]!);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    sim.x[i] = point.x;
    sim.y[i] = point.y;
    placed[i] = 1;
    known++;
  }
  if (known < count) {
    const sumX = new Float64Array(count);
    const sumY = new Float64Array(count);
    const near = new Uint16Array(count);
    for (const { source, target } of sim.links) {
      if (placed[source] && !placed[target]) {
        sumX[target]! += sim.x[source]!;
        sumY[target]! += sim.y[source]!;
        near[target]!++;
      }
      if (placed[target] && !placed[source]) {
        sumX[source]! += sim.x[target]!;
        sumY[source]! += sim.y[target]!;
        near[source]!++;
      }
    }
    for (let i = 0; i < count; i++) {
      if (placed[i]) continue;
      const seed = seedPosition(ids[i]!, count);
      if (near[i]) {
        const scale = 24 / (Math.hypot(seed.x, seed.y) || 1);
        sim.x[i] = sumX[i]! / near[i]! + seed.x * scale;
        sim.y[i] = sumY[i]! / near[i]! + seed.y * scale;
      } else {
        sim.x[i] = seed.x;
        sim.y[i] = seed.y;
      }
    }
  }
  sim.alpha = !count ? 0 : known === count ? 0.08 : known > 0 ? 0.4 : 1;
  return sim;
}

export const isSettled = (sim: Simulation): boolean =>
  sim.alpha < layoutDefaults.alphaMin && sim.alphaTarget < layoutDefaults.alphaMin;

export function reheat(sim: Simulation, alpha: number): void {
  if (sim.alpha < alpha) sim.alpha = alpha;
}

const force = { fx: 0, fy: 0 };

/** 推进一帧；返回 true 表示仍在收敛中 */
export function stepSimulation(sim: Simulation, options = layoutDefaults): boolean {
  if (isSettled(sim) || !sim.count) return false;
  sim.alpha += (sim.alphaTarget - sim.alpha) * options.alphaDecay;
  const { count, x, y, vx, vy, fixed, degree } = sim;
  const alpha = sim.alpha;
  const masses = new Float32Array(count);
  for (let i = 0; i < count; i++) masses[i] = 1 + Math.min(degree[i]!, 30) * 0.08;
  const tree = buildQuadtree(x, y, count, masses);
  for (let i = 0; i < count; i++) {
    force.fx = 0;
    force.fy = 0;
    repulsionAt(tree, i, x[i]!, y[i]!, options.repulsion, options.theta, options.minDistance, force);
    vx[i] = vx[i]! + (force.fx - x[i]! * options.gravity) * alpha;
    vy[i] = vy[i]! + (force.fy - y[i]! * options.gravity) * alpha;
  }
  for (const link of sim.links) {
    const a = link.source;
    const b = link.target;
    let dx = x[b]! + vx[b]! - x[a]! - vx[a]!;
    let dy = y[b]! + vy[b]! - y[a]! - vy[a]!;
    let distance = Math.hypot(dx, dy);
    if (distance < 1e-6) {
      dx = 0.01 * (a < b ? 1 : -1);
      dy = 0.01;
      distance = Math.hypot(dx, dy);
    }
    const da = degree[a]!;
    const db = degree[b]!;
    const pull =
      (((distance - options.linkDistance) / distance) *
        alpha *
        options.linkStrength *
        Math.min(1.6, 0.7 + link.weight * 0.15)) /
      Math.sqrt(Math.min(da, db));
    const bias = da / (da + db);
    vx[b] = vx[b]! - dx * pull * bias;
    vy[b] = vy[b]! - dy * pull * bias;
    vx[a] = vx[a]! + dx * pull * (1 - bias);
    vy[a] = vy[a]! + dy * pull * (1 - bias);
  }
  for (let i = 0; i < count; i++) {
    if (fixed[i]) {
      vx[i] = 0;
      vy[i] = 0;
      continue;
    }
    let sx = vx[i]! * options.friction;
    let sy = vy[i]! * options.friction;
    const speed = Math.hypot(sx, sy);
    if (speed > options.maxSpeed) {
      sx *= options.maxSpeed / speed;
      sy *= options.maxSpeed / speed;
    }
    vx[i] = sx;
    vy[i] = sy;
    x[i] = x[i]! + sx;
    y[i] = y[i]! + sy;
  }
  return !isSettled(sim);
}

/** 同步收敛至静止（用于小图首帧预热与单元测试） */
export function settle(sim: Simulation, maxSteps = 600): number {
  let steps = 0;
  while (steps < maxSteps && stepSimulation(sim)) steps++;
  return steps;
}

export function bounds(sim: Simulation): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!sim.count) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < sim.count; i++) {
    const px = sim.x[i]!;
    const py = sim.y[i]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY };
}

/** 命中测试：返回世界坐标 (px, py) 下最近的节点索引，未命中返回 -1 */
export function nodeAt(
  sim: Simulation,
  px: number,
  py: number,
  radius: (index: number) => number,
  slack: number,
): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < sim.count; i++) {
    const dx = sim.x[i]! - px;
    const dy = sim.y[i]! - py;
    const reach = radius(i) + slack;
    const d2 = dx * dx + dy * dy;
    if (d2 <= reach * reach && d2 < bestDistance) {
      best = i;
      bestDistance = d2;
    }
  }
  return best;
}
