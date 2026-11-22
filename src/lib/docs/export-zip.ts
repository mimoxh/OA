import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { db } from "@/lib/db";
import { attachmentPath, parseAttachmentUrl } from "./attachments";
import { parseContent, type JSONNode } from "./content";
import { docToMarkdown } from "./markdown";
import { parseWhiteboard, whiteboardAttachmentIds, whiteboardLinkContent, whiteboardText } from "./whiteboard/content";

export class ZipExportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const ZIP_MAX_BYTES = 200 * 1024 * 1024;
export const EXPORT_FORMAT = "oa-docs-export-v1";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};

function extFor(mediaType: string, fileName: string): string {
  const base = mediaType.split(";")[0].trim().toLowerCase();
  if (EXT_BY_TYPE[base]) return EXT_BY_TYPE[base];
  const e = fileName.includes(".") ? "." + fileName.split(".").pop()!.toLowerCase() : "";
  return /^\.[a-z0-9]{1,10}$/.test(e) ? e : ".bin";
}

/** 文件名净化：去掉路径与非法字符，限制长度 */
export function safeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim().slice(0, 80).trim();
  return clean || "无标题";
}

export function zipFileName(name: string): string {
  return encodeURIComponent(safeFileName(name)) + ".zip";
}

export type ZipPage = { id: string; title: string; icon: string | null; parentId: string | null; content: string; kind?: string };

/** 收集文档 JSON 中引用的附件 id（fileAttachment 节点 + 内部图片地址） */
export function collectAttachmentIds(json: JSONNode, into = new Set<string>()): Set<string> {
  const walk = (n: JSONNode) => {
    if (n.type === "fileAttachment" && typeof n.attrs?.id === "string") into.add(n.attrs.id);
    if (n.type === "image" && typeof n.attrs?.src === "string") {
      const id = parseAttachmentUrl(n.attrs.src);
      if (id) into.add(id);
    }
    n.content?.forEach(walk);
  };
  walk(json);
  return into;
}

/** 对相对路径中的 Markdown 敏感字符（空白、括号、#?% 等）做百分号编码，保留中文可读性 */
const encodeRelSeg = (seg: string) =>
  seg === "." || seg === ".."
    ? seg
    : seg.replace(/[%\s()<>[\]#?"'\\]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

const rel = (fromFile: string, toPath: string) =>
  path.posix.relative(path.posix.dirname(fromFile), toPath).split("/").map(encodeRelSeg).join("/");

/**
 * 打包页面树为 ZIP：pages/<标题>.md（子页面在父标题目录下）、attachments/<id><ext>、manifest.json。
 * pages 需按 DFS（父先子后）顺序传入；rootIds 为顶层页面；附件严格限定在 spaceId 空间内。
 */
export async function buildDocsZip(spaceId: string, pages: ZipPage[], rootIds: string[]): Promise<Uint8Array> {
  const byParent = new Map<string | null, ZipPage[]>();
  const ids = new Set(pages.map((p) => p.id));
  for (const p of pages) {
    const key = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(p);
  }

  // 分配 md 路径（同级去重）
  const mdPath = new Map<string, string>();
  const parentMdPath = new Map<string, string | null>();
  const ordered: ZipPage[] = [];
  const assign = (parentId: string | null, dir: string, parentPath: string | null) => {
    const used = new Set<string>();
    for (const p of byParent.get(parentId) ?? []) {
      const base = safeFileName(p.title);
      let name = base;
      for (let i = 2; used.has(name); i++) name = `${base} (${i})`;
      used.add(name);
      const file = `${dir}${name}.md`;
      mdPath.set(p.id, file);
      parentMdPath.set(p.id, parentPath);
      ordered.push(p);
      assign(p.id, `${dir}${name}/`, file);
    }
  };
  assign(null, "pages/", null);
  for (const id of rootIds) if (!mdPath.has(id)) throw new ZipExportError("导出的页面结构异常", 500);

  // 收集全部引用附件并读盘（仅允许当前空间内的附件，防止跨空间越权读取）
  const refIds = new Set<string>();
  const parsed = new Map<string, JSONNode>();
  const whiteboardPaths = new Map<string, string>();
  for (const p of ordered) {
    if (p.kind === "whiteboard") {
      const scene = parseWhiteboard(p.content);
      if (!scene) throw new ZipExportError("白板内容无法读取", 422);
      whiteboardPaths.set(p.id, `whiteboards/${p.id}.whiteboard.json`);
      for (const id of whiteboardAttachmentIds(scene.elements)) refIds.add(id);
      const text = whiteboardText(scene.elements);
      const links = whiteboardLinkContent(scene.elements);
      parsed.set(p.id, {
        type: "doc",
        content: [
          ...text.split("\n").filter(Boolean).map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
          ...(links.content ?? []),
        ],
      });
      continue;
    }
    const json = parseContent(p.content);
    parsed.set(p.id, json);
    collectAttachmentIds(json, refIds);
  }
  const attEntries = new Map<string, { path: string; fileName: string; mediaType: string; bytes: Uint8Array }>();
  let total = 0;
  for (const id of refIds) {
    const row = await db.attachment.findUnique({ where: { id } });
    if (!row || row.spaceId !== spaceId) throw new ZipExportError("页面引用的附件已不存在", 503);
    const bytes = await readFile(attachmentPath(id)).catch(() => {
      throw new ZipExportError(`附件文件缺失：${row.fileName}`, 503);
    });
    const p = `attachments/${id}${extFor(row.mediaType, row.fileName)}`;
    attEntries.set(id, { path: p, fileName: row.fileName, mediaType: row.mediaType, bytes });
    total += bytes.byteLength;
    if (total > ZIP_MAX_BYTES) throw new ZipExportError("导出内容超过 200MB 限制", 413);
  }

  const files: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  for (const att of attEntries.values()) {
    files[att.path] = att.bytes;
  }

  const manifest = {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    pages: ordered.map((p) => ({ path: mdPath.get(p.id)!, parentPath: parentMdPath.get(p.id) ?? null, title: p.title, icon: p.icon })),
    attachments: [
      ...[...attEntries.values()].map((a) => ({ path: a.path, fileName: a.fileName, mediaType: a.mediaType })),
      ...ordered.flatMap((p) => {
        const path = whiteboardPaths.get(p.id);
        return path ? [{ path, fileName: `${safeFileName(p.title)}.whiteboard.json`, mediaType: "application/json" }] : [];
      }),
    ],
  };

  for (const p of ordered) {
    const file = mdPath.get(p.id)!;
    const md = docToMarkdown(parsed.get(p.id)!, {
      title: p.title,
      icon: p.icon,
      resolveAttachment: (a) => {
        const att = attEntries.get(a.id);
        return att ? rel(file, att.path) : null;
      },
      resolveDocLink: (docId) => {
        const target = mdPath.get(docId);
        return target ? rel(file, target) : null;
      },
    });
    const whiteboardPath = whiteboardPaths.get(p.id);
    if (whiteboardPath) {
      files[whiteboardPath] = enc.encode(p.content);
      total += files[whiteboardPath].byteLength;
    }
    const mdBytes = enc.encode(whiteboardPath ? `${md}\n[白板源数据](${rel(file, whiteboardPath)})\n` : md);
    total += mdBytes.byteLength;
    if (total > ZIP_MAX_BYTES) throw new ZipExportError("导出内容超过 200MB 限制", 413);
    files[file] = mdBytes;
  }
  files["manifest.json"] = enc.encode(JSON.stringify(manifest, null, 2));

  return zipSync(files);
}
