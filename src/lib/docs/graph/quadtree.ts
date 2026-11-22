/**
 * Barnes–Hut 四叉树（基于扁平数组）。
 * 超过 maxDepth 时将重合节点合并为聚合叶节点，防止无限递归。
 */
export interface Quadtree {
  size: number;
  comX: Float64Array;
  comY: Float64Array;
  mass: Float64Array;
  width: Float64Array;
  child: Int32Array;
  body: Int32Array;
}

const MAX_DEPTH = 20;

export function buildQuadtree(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  count: number,
  masses?: ArrayLike<number>,
): Quadtree {
  let capacity = Math.max(16, count * 4);
  let comX = new Float64Array(capacity);
  let comY = new Float64Array(capacity);
  let mass = new Float64Array(capacity);
  let width = new Float64Array(capacity);
  let child = new Int32Array(capacity).fill(-1);
  let body = new Int32Array(capacity).fill(-1);

  const grow = () => {
    const next = capacity * 2;
    const copy = <T extends Float64Array | Int32Array>(from: T, fill?: number): T => {
      const to = (from instanceof Float64Array ? new Float64Array(next) : new Int32Array(next)) as T;
      if (fill !== undefined) to.fill(fill);
      to.set(from);
      return to;
    };
    comX = copy(comX);
    comY = copy(comY);
    mass = copy(mass);
    width = copy(width);
    child = copy(child, -1);
    body = copy(body, -1);
    capacity = next;
  };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const px = x[i]!;
    const py = y[i]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (!count) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }

  const rootWidth = Math.max(maxX - minX, maxY - minY, 1e-3) * 1.0001;
  let size = 1;
  width[0] = rootWidth;

  const add = (cell: number, px: number, py: number, m: number) => {
    const total = mass[cell]! + m;
    comX[cell] = (comX[cell]! * mass[cell]! + px * m) / total;
    comY[cell] = (comY[cell]! * mass[cell]! + py * m) / total;
    mass[cell] = total;
  };

  const split = (cell: number) => {
    if (size + 4 > capacity) grow();
    child[cell] = size;
    for (let k = 0; k < 4; k++) width[size + k] = width[cell]! / 2;
    size += 4;
  };

  for (let i = 0; i < count; i++) {
    const px = x[i]!;
    const py = y[i]!;
    const m = masses ? masses[i]! : 1;
    let cell = 0;
    let x0 = minX;
    let y0 = minY;
    let depth = 0;
    for (;;) {
      if (child[cell] === -1) {
        if (mass[cell] === 0) {
          body[cell] = i;
          add(cell, px, py, m);
          break;
        }
        if (body[cell] === -2 || depth >= MAX_DEPTH) {
          body[cell] = -2;
          add(cell, px, py, m);
          break;
        }
        const resident = body[cell]!;
        const rx = x[resident]!;
        const ry = y[resident]!;
        const half = width[cell]! / 2;
        split(cell);
        const target = child[cell]! + (rx >= x0 + half ? 1 : 0) + (ry >= y0 + half ? 2 : 0);
        body[target] = resident;
        comX[target] = rx;
        comY[target] = ry;
        mass[target] = mass[cell]!;
        body[cell] = -1;
      }
      add(cell, px, py, m);
      const half = width[cell]! / 2;
      const right = px >= x0 + half;
      const down = py >= y0 + half;
      cell = child[cell]! + (right ? 1 : 0) + (down ? 2 : 0);
      if (right) x0 += half;
      if (down) y0 += half;
      depth++;
    }
  }

  return { size, comX, comY, mass, width, child, body };
}

const stack = new Int32Array(1024);

/** 计算四叉树对节点 index 的斥力（1/d 衰减，近距离截断以防爆炸） */
export function repulsionAt(
  tree: Quadtree,
  index: number,
  px: number,
  py: number,
  strength: number,
  theta: number,
  minDistance: number,
  out: { fx: number; fy: number },
): void {
  const theta2 = theta * theta;
  const min2 = minDistance * minDistance;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const cell = stack[--top]!;
    const m = tree.mass[cell]!;
    if (m === 0) continue;
    const first = tree.child[cell]!;
    if (first === -1 && tree.body[cell] === index) continue;
    let dx = px - tree.comX[cell]!;
    let dy = py - tree.comY[cell]!;
    let d2 = dx * dx + dy * dy;
    const w = tree.width[cell]!;
    if (first !== -1 && w * w >= theta2 * d2) {
      if (top + 4 <= stack.length) {
        stack[top++] = first;
        stack[top++] = first + 1;
        stack[top++] = first + 2;
        stack[top++] = first + 3;
      }
      continue;
    }
    if (d2 < 1e-9) {
      const angle = (index * 2.399963229728653) % (Math.PI * 2);
      dx = Math.cos(angle) * minDistance;
      dy = Math.sin(angle) * minDistance;
      d2 = min2;
    } else if (d2 < min2) {
      const scale = Math.sqrt(min2 / d2);
      dx *= scale;
      dy *= scale;
      d2 = min2;
    }
    const force = (strength * m) / d2;
    out.fx += dx * force;
    out.fy += dy * force;
  }
}
