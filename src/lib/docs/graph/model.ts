import type { GraphNodeDTO, GraphPayload, GraphSpaceDTO } from "@/lib/docs/links";

export type GraphColorMode = "space" | "group" | "none";

export interface GraphFilter {
  spaceId: string | null;
  query: string;
  showOrphans: boolean;
  showTreeEdges: boolean;
  local: boolean;
  focusId: string | null;
  depth: 1 | 2 | 3;
}

export interface GraphViewNode extends GraphNodeDTO {
  spaceName: string;
  spaceIcon: string;
  groupId: string;
  groupTitle: string;
  degree: number;
  inDegree: number;
  outDegree: number;
}

export interface GraphViewLink {
  source: number;
  target: number;
  kind: "link" | "tree";
  forward: number;
  backward: number;
}

export interface GraphNeighborEntry {
  id: string;
  title: string;
  icon: string | null;
  spaceName: string;
  spaceIcon: string;
  count: number;
}

export interface GraphViewModel {
  nodes: GraphViewNode[];
  links: GraphViewLink[];
  index: Map<string, number>;
  neighbors: number[][];
  outgoing: Map<string, GraphNeighborEntry[]>;
  incoming: Map<string, GraphNeighborEntry[]>;
  spaces: GraphSpaceDTO[];
  linkEdgeCount: number;
}

const PALETTE = [
  "#2383e2",
  "#2f9e44",
  "#d97706",
  "#9333ea",
  "#e11d48",
  "#0891b2",
  "#4f46e5",
  "#b45309",
  "#059669",
  "#7c3aed",
];

function hashString(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function paletteColor(key: string): string {
  return PALETTE[hashString(key) % PALETTE.length]!;
}

export function nodeTitle(node: Pick<GraphNodeDTO, "title">): string {
  return node.title.trim() || "无标题";
}

export function nodeColor(node: GraphViewNode, mode: GraphColorMode): string | null {
  if (mode === "none") return null;
  if (mode === "space") return paletteColor(`space:${node.spaceId}`);
  return paletteColor(`group:${node.groupId}`);
}

export function nodeRadius(degree: number): number {
  return Math.min(18, 5 + Math.sqrt(Math.max(0, degree)) * 2.2);
}

/** 根据度数决定文字标签开始显示的缩放阈值：枢纽节点在低缩放时即显示 */
export function labelZoom(degree: number): number {
  if (degree >= 12) return 0.32;
  if (degree >= 6) return 0.45;
  if (degree >= 3) return 0.6;
  if (degree >= 1) return 0.78;
  return 0.95;
}

export function truncateLabel(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  count: number;
}

export function buildLegend(view: GraphViewModel, mode: GraphColorMode, max = 10): LegendEntry[] {
  if (mode === "none") return [];
  const groups = new Map<string, LegendEntry>();
  for (const node of view.nodes) {
    const key = mode === "space" ? node.spaceId : node.groupId;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      const label = mode === "space" ? `${node.spaceIcon} ${node.spaceName}` : node.groupTitle;
      const color = nodeColor(node, mode) ?? "#787774";
      groups.set(key, { key, label, color, count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN")).slice(0, max);
}

/**
 * 将后端返回的原始图谱数据按当前筛选条件转换为可渲染的 GraphViewModel。
 */
export function buildGraphView(data: GraphPayload, filter: GraphFilter): GraphViewModel {
  const spaceMap = new Map(data.spaces.map((s) => [s.id, s]));
  const rawNodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  // 1. 空间筛选
  const scopedNodes = filter.spaceId
    ? data.nodes.filter((n) => n.spaceId === filter.spaceId)
    : data.nodes;
  const scopedSet = new Set(scopedNodes.map((n) => n.id));

  // 2. 构建双链邻接表（及可选的父子层级边）
  const adj = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string) => {
    if (a === b) return;
    let sa = adj.get(a);
    if (!sa) {
      sa = new Set();
      adj.set(a, sa);
    }
    sa.add(b);
    let sb = adj.get(b);
    if (!sb) {
      sb = new Set();
      adj.set(b, sb);
    }
    sb.add(a);
  };

  for (const edge of data.edges) {
    if (scopedSet.has(edge.sourceId) && scopedSet.has(edge.targetId)) {
      addAdj(edge.sourceId, edge.targetId);
    }
  }
  if (filter.showTreeEdges) {
    for (const node of scopedNodes) {
      if (node.parentId && scopedSet.has(node.parentId)) {
        addAdj(node.parentId, node.id);
      }
    }
  }

  // 3. 局部模式 BFS 邻域（depth 1..3）
  let candidateIds = scopedSet;
  if (filter.local && filter.focusId && scopedSet.has(filter.focusId)) {
    const visited = new Set<string>([filter.focusId]);
    let frontier = [filter.focusId];
    for (let step = 0; step < filter.depth && frontier.length > 0; step++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of adj.get(cur) ?? []) {
          if (!visited.has(nb)) {
            visited.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    candidateIds = visited;
  }

  // 4. 关键词筛选（标题子串）
  const q = filter.query.trim().toLowerCase();
  if (q) {
    const matched = new Set<string>();
    for (const id of candidateIds) {
      const node = rawNodeMap.get(id);
      if (node && nodeTitle(node).toLowerCase().includes(q)) matched.add(id);
    }
    candidateIds = matched;
  }

  // 5. 孤立节点过滤（基于当前候选集合内的双链/层级边度数）
  const candidateDegree = new Map<string, number>();
  for (const edge of data.edges) {
    if (candidateIds.has(edge.sourceId) && candidateIds.has(edge.targetId) && edge.sourceId !== edge.targetId) {
      candidateDegree.set(edge.sourceId, (candidateDegree.get(edge.sourceId) ?? 0) + 1);
      candidateDegree.set(edge.targetId, (candidateDegree.get(edge.targetId) ?? 0) + 1);
    }
  }
  if (filter.showTreeEdges) {
    for (const id of candidateIds) {
      const node = rawNodeMap.get(id);
      if (node?.parentId && candidateIds.has(node.parentId) && node.parentId !== id) {
        candidateDegree.set(id, (candidateDegree.get(id) ?? 0) + 1);
        candidateDegree.set(node.parentId, (candidateDegree.get(node.parentId) ?? 0) + 1);
      }
    }
  }

  const finalNodesRaw: GraphNodeDTO[] = [];
  for (const node of scopedNodes) {
    if (!candidateIds.has(node.id)) continue;
    const deg = candidateDegree.get(node.id) ?? 0;
    const keepFocus = filter.local && filter.focusId === node.id;
    if (!filter.showOrphans && deg === 0 && !keepFocus) continue;
    finalNodesRaw.push(node);
  }

  // 6. 顶层祖先归组（用于 group 着色模式）
  const rootCache = new Map<string, string>();
  const findRoot = (id: string): string => {
    const cached = rootCache.get(id);
    if (cached) return cached;
    const seen = new Set<string>();
    let cur = id;
    while (true) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const p = rawNodeMap.get(cur)?.parentId;
      if (!p || !rawNodeMap.has(p)) break;
      cur = p;
    }
    for (const s of seen) rootCache.set(s, cur);
    return cur;
  };

  const index = new Map<string, number>();
  const nodes: GraphViewNode[] = finalNodesRaw.map((n, i) => {
    index.set(n.id, i);
    const space = spaceMap.get(n.spaceId);
    const groupId = findRoot(n.id);
    const rootNode = rawNodeMap.get(groupId);
    return {
      ...n,
      spaceName: space?.name ?? "空间",
      spaceIcon: space?.icon ?? "📁",
      groupId,
      groupTitle: rootNode ? nodeTitle(rootNode) : nodeTitle(n),
      degree: 0,
      inDegree: 0,
      outDegree: 0,
    };
  });

  // 7. 合并双向引用边并记录出链/反链详情
  const pairLinks = new Map<string, GraphViewLink>();
  const outgoing = new Map<string, GraphNeighborEntry[]>();
  const incoming = new Map<string, GraphNeighborEntry[]>();

  const pushEntry = (map: Map<string, GraphNeighborEntry[]>, key: string, target: GraphViewNode, count: number) => {
    const list = map.get(key) ?? [];
    list.push({
      id: target.id,
      title: nodeTitle(target),
      icon: target.icon,
      spaceName: target.spaceName,
      spaceIcon: target.spaceIcon,
      count,
    });
    map.set(key, list);
  };

  let linkEdgeCount = 0;
  for (const edge of data.edges) {
    const si = index.get(edge.sourceId);
    const ti = index.get(edge.targetId);
    if (si === undefined || ti === undefined || si === ti) continue;
    linkEdgeCount += 1;
    const sNode = nodes[si]!;
    const tNode = nodes[ti]!;
    sNode.outDegree += 1;
    tNode.inDegree += 1;
    pushEntry(outgoing, sNode.id, tNode, edge.count);
    pushEntry(incoming, tNode.id, sNode, edge.count);

    const forward = si < ti;
    const a = forward ? si : ti;
    const b = forward ? ti : si;
    const key = `${a}:${b}`;
    const existing = pairLinks.get(key);
    if (existing) {
      if (forward) existing.forward += edge.count;
      else existing.backward += edge.count;
    } else {
      pairLinks.set(key, {
        source: a,
        target: b,
        kind: "link",
        forward: forward ? edge.count : 0,
        backward: forward ? 0 : edge.count,
      });
    }
  }

  const links: GraphViewLink[] = [...pairLinks.values()];

  // 8. 可选的父子层级边（不覆盖已有的双链边）
  if (filter.showTreeEdges) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (!node.parentId) continue;
      const pi = index.get(node.parentId);
      if (pi === undefined || pi === i) continue;
      const a = Math.min(pi, i);
      const b = Math.max(pi, i);
      if (pairLinks.has(`${a}:${b}`)) continue;
      links.push({ source: pi, target: i, kind: "tree", forward: 1, backward: 0 });
    }
  }

  const neighborSets = nodes.map(() => new Set<number>());
  for (const link of links) {
    neighborSets[link.source]!.add(link.target);
    neighborSets[link.target]!.add(link.source);
  }
  const neighbors = neighborSets.map((s, i) => {
    nodes[i]!.degree = s.size;
    return [...s];
  });

  // 出链/反链列表按引用次数降序、标题升序排序
  const sortEntries = (list: GraphNeighborEntry[]) =>
    list.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "zh-CN"));
  for (const list of outgoing.values()) sortEntries(list);
  for (const list of incoming.values()) sortEntries(list);

  return {
    nodes,
    links,
    index,
    neighbors,
    outgoing,
    incoming,
    spaces: data.spaces,
    linkEdgeCount,
  };
}
