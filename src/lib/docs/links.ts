import { db, type DbClient } from "@/lib/db";
import { visibleSpaceWhere, type DocUser } from "./access";
import type { JSONNode } from "./content";

export const PAGE_BACKLINK_LIMIT = 100;
export const GRAPH_NODE_LIMIT = 2000;
export const GRAPH_EDGE_LIMIT = 10000;

const DOC_LINK_RE = /^\/docs\/([\w-]+)(?:[?#].*)?$/;
const RESERVED_DOC_SLUGS = new Set(["graph", "trash", "templates", "new"]);
const SNIPPET_MAX = 160;

export type ExtractedDocLink = {
  targetDocId: string;
  occurrence: number;
  snippet: string;
};

export type BacklinkItem = {
  id: string;
  sourceDocId: string;
  sourceTitle: string;
  sourceIcon: string | null;
  spaceId: string;
  spaceName: string;
  spaceIcon: string;
  occurrence: number;
  snippet: string;
  updatedAt: string;
};

export type BacklinksResult = {
  links: BacklinkItem[];
  truncated: boolean;
};

export type GraphSpaceDTO = {
  id: string;
  name: string;
  icon: string;
};

export type GraphNodeDTO = {
  id: string;
  title: string;
  icon: string | null;
  spaceId: string;
  parentId: string | null;
  updatedAt: string;
};

export type GraphEdgeDTO = {
  sourceId: string;
  targetId: string;
  count: number;
};

export type GraphPayload = {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  spaces: GraphSpaceDTO[];
  truncated: boolean;
};

/** 从站内链接 href 提取文档 id；非文档链接或保留路径返回 null */
export function parseDocLinkId(href: string): string | null {
  const m = DOC_LINK_RE.exec(href.trim());
  if (!m) return null;
  const id = m[1];
  if (!id || RESERVED_DOC_SLUGS.has(id.toLowerCase())) return null;
  return id;
}

/** 围绕命中区间裁剪段落摘要，保证上下文清晰且长度受控 */
function buildSnippet(rawText: string, matchStart: number, matchEnd: number): string {
  // 把连续空白折叠为单空格，并同步映射命中位置
  let normalized = "";
  let normStart = -1;
  let normEnd = -1;
  let prevSpace = true;
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    const isSpace = /\s/.test(ch);
    if (i === matchStart && normStart < 0) normStart = normalized.length;
    if (isSpace) {
      if (!prevSpace) {
        normalized += " ";
        prevSpace = true;
      }
    } else {
      normalized += ch;
      prevSpace = false;
    }
    if (i + 1 === matchEnd) normEnd = normalized.length;
  }
  normalized = normalized.trim();
  if (!normalized) return "";
  if (normalized.length <= SNIPPET_MAX) return normalized;

  const s = Math.max(0, normStart < 0 ? 0 : normStart);
  const e = Math.max(s, normEnd < 0 ? s : normEnd);
  const center = Math.floor((s + e) / 2);
  let start = Math.max(0, center - Math.floor(SNIPPET_MAX / 2));
  let end = start + SNIPPET_MAX;
  if (end > normalized.length) {
    end = normalized.length;
    start = Math.max(0, end - SNIPPET_MAX);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
}

const INLINE_CONTAINERS = new Set(["paragraph", "heading"]);

/**
 * 从 Tiptap JSON 中提取所有站内文档链接（`/docs/<id>`）。
 * 同一段落内相邻且共享相同 href 的文本节点合并为一次出现（例如链接内部含加粗）。
 */
export function extractDocLinks(doc: JSONNode): ExtractedDocLink[] {
  const out: ExtractedDocLink[] = [];

  const scanInlineContainer = (container: JSONNode) => {
    const pieces: string[] = [];
    const hits: { targetDocId: string; start: number; end: number }[] = [];
    let offset = 0;
    let activeTarget: string | null = null;
    let activeHitIndex = -1;

    const visitInline = (node: JSONNode) => {
      if (node.type === "text") {
        const text = node.text ?? "";
        const linkMark = node.marks?.find((m) => m.type === "link" && typeof m.attrs?.href === "string");
        const targetDocId = linkMark ? parseDocLinkId(String(linkMark.attrs?.href ?? "")) : null;
        const start = offset;
        pieces.push(text);
        offset += text.length;
        if (targetDocId) {
          if (activeTarget === targetDocId && activeHitIndex >= 0) {
            hits[activeHitIndex].end = offset;
          } else {
            hits.push({ targetDocId, start, end: offset });
            activeTarget = targetDocId;
            activeHitIndex = hits.length - 1;
          }
        } else {
          activeTarget = null;
          activeHitIndex = -1;
        }
        return;
      }
      activeTarget = null;
      activeHitIndex = -1;
      if (node.type === "mention") {
        const text = `@${String(node.attrs?.label ?? node.attrs?.id ?? "")}`;
        pieces.push(text);
        offset += text.length;
      } else if (node.type === "hardBreak") {
        pieces.push(" ");
        offset += 1;
      } else if (node.content) {
        for (const child of node.content) visitInline(child);
      }
    };

    for (const child of container.content ?? []) visitInline(child);
    if (!hits.length) return;
    const rawText = pieces.join("");
    for (const hit of hits) {
      out.push({
        targetDocId: hit.targetDocId,
        occurrence: out.length,
        snippet: buildSnippet(rawText, hit.start, hit.end),
      });
    }
  };

  const walk = (node: JSONNode) => {
    if (node.type && INLINE_CONTAINERS.has(node.type)) {
      scanInlineContainer(node);
      return;
    }
    if (node.type === "codeBlock") return;
    for (const child of node.content ?? []) walk(child);
  };

  walk(doc);
  return out;
}

type SyncOptions = { isTemplate?: boolean };

async function replaceLinks(tx: DbClient, sourceDocId: string, rows: { targetDocId: string; occurrence: number; snippet: string }[]) {
  await tx.documentLink.deleteMany({ where: { sourceDocId } });
  if (rows.length > 0) {
    await tx.documentLink.createMany({
      data: rows.map((r) => ({
        sourceDocId,
        targetDocId: r.targetDocId,
        occurrence: r.occurrence,
        snippet: r.snippet,
      })),
    });
  }
}

/**
 * 全量同步某文档的出链索引：
 * - 模板文档不产生出链；
 * - 自动忽略指向自身的链接与不存在的目标文档（避免外键报错）；
 * - 保留指向回收站文档的边，待目标恢复时反链自动恢复（查询时按 deletedAt: null 过滤）。
 */
export async function syncDocumentLinks(client: DbClient, sourceDocId: string, doc: JSONNode, opts?: SyncOptions): Promise<number> {
  let isTemplate = opts?.isTemplate;
  if (isTemplate === undefined) {
    const row = await client.document.findUnique({ where: { id: sourceDocId }, select: { isTemplate: true } });
    if (!row) return 0;
    isTemplate = row.isTemplate;
  }

  const write = async (tx: DbClient, rows: { targetDocId: string; occurrence: number; snippet: string }[]) => {
    if ("$transaction" in tx && typeof tx.$transaction === "function") {
      await tx.$transaction(async (inner) => {
        await replaceLinks(inner, sourceDocId, rows);
      });
    } else {
      await replaceLinks(tx, sourceDocId, rows);
    }
  };

  if (isTemplate) {
    await write(client, []);
    return 0;
  }

  const extracted = extractDocLinks(doc).filter((l) => l.targetDocId !== sourceDocId);
  if (!extracted.length) {
    await write(client, []);
    return 0;
  }

  const uniqueTargets = [...new Set(extracted.map((l) => l.targetDocId))];
  const existingTargets = await client.document.findMany({
    where: { id: { in: uniqueTargets }, isTemplate: false },
    select: { id: true },
  });
  const validIds = new Set(existingTargets.map((d) => d.id));
  const filtered = extracted
    .filter((l) => validIds.has(l.targetDocId))
    .map((l, index) => ({ targetDocId: l.targetDocId, occurrence: index, snippet: l.snippet }));

  await write(client, filtered);
  return filtered.length;
}

/** 查询当前用户可见的指向目标文档的反向链接 */
export async function queryBacklinks(user: DocUser, targetDocId: string, client: DbClient = db): Promise<BacklinksResult> {
  const rows = await client.documentLink.findMany({
    where: {
      targetDocId,
      sourceDoc: {
        deletedAt: null,
        isTemplate: false,
        space: visibleSpaceWhere(user),
      },
    },
    orderBy: [{ sourceDoc: { updatedAt: "desc" } }, { occurrence: "asc" }],
    take: PAGE_BACKLINK_LIMIT + 1,
    select: {
      id: true,
      occurrence: true,
      snippet: true,
      sourceDoc: {
        select: {
          id: true,
          title: true,
          icon: true,
          updatedAt: true,
          spaceId: true,
          space: { select: { name: true, icon: true } },
        },
      },
    },
  });

  const truncated = rows.length > PAGE_BACKLINK_LIMIT;
  const slice = truncated ? rows.slice(0, PAGE_BACKLINK_LIMIT) : rows;
  return {
    links: slice.map((r) => ({
      id: r.id,
      sourceDocId: r.sourceDoc.id,
      sourceTitle: r.sourceDoc.title || "无标题",
      sourceIcon: r.sourceDoc.icon,
      spaceId: r.sourceDoc.spaceId,
      spaceName: r.sourceDoc.space.name,
      spaceIcon: r.sourceDoc.space.icon,
      occurrence: r.occurrence,
      snippet: r.snippet,
      updatedAt: r.sourceDoc.updatedAt.toISOString(),
    })),
    truncated,
  };
}

/** 查询关系图所需的可见节点与聚合边（按 spaceId 可选收敛到单空间） */
export async function queryGraphData(user: DocUser, spaceId?: string | null, client: DbClient = db): Promise<GraphPayload> {
  const spaces = await client.space.findMany({
    where: visibleSpaceWhere(user),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, icon: true },
  });
  const visibleSpaceIds = new Set(spaces.map((s) => s.id));
  if (spaceId && !visibleSpaceIds.has(spaceId)) {
    return { nodes: [], edges: [], spaces, truncated: false };
  }

  const docWhere = spaceId
    ? { spaceId, deletedAt: null, isTemplate: false }
    : { spaceId: { in: [...visibleSpaceIds] }, deletedAt: null, isTemplate: false };

  const docRows = await client.document.findMany({
    where: docWhere,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: GRAPH_NODE_LIMIT + 1,
    select: { id: true, title: true, icon: true, spaceId: true, parentId: true, updatedAt: true },
  });

  let truncated = docRows.length > GRAPH_NODE_LIMIT;
  const docs = truncated ? docRows.slice(0, GRAPH_NODE_LIMIT) : docRows;
  const nodeIds = new Set(docs.map((d) => d.id));

  const nodes: GraphNodeDTO[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    icon: d.icon,
    spaceId: d.spaceId,
    parentId: d.parentId && nodeIds.has(d.parentId) ? d.parentId : null,
    updatedAt: d.updatedAt.toISOString(),
  }));

  if (nodes.length === 0) {
    return { nodes: [], edges: [], spaces, truncated };
  }

  const rawLinks = await client.documentLink.findMany({
    where: {
      sourceDoc: docWhere,
      targetDoc: docWhere,
    },
    select: { sourceDocId: true, targetDocId: true },
  });

  const counts = new Map<string, GraphEdgeDTO>();
  for (const link of rawLinks) {
    if (link.sourceDocId === link.targetDocId) continue;
    if (!nodeIds.has(link.sourceDocId) || !nodeIds.has(link.targetDocId)) continue;
    const key = `${link.sourceDocId}\0${link.targetDocId}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      if (counts.size >= GRAPH_EDGE_LIMIT) {
        truncated = true;
        break;
      }
      counts.set(key, { sourceId: link.sourceDocId, targetId: link.targetDocId, count: 1 });
    }
  }

  return {
    nodes,
    edges: [...counts.values()],
    spaces,
    truncated,
  };
}
