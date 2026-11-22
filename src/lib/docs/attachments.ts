import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, type DbClient } from "@/lib/db";

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachmentDir() {
  const dir = process.env.ATTACHMENT_DIR ?? "storage/attachments";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

export function attachmentPath(id: string) {
  return path.join(attachmentDir(), id);
}

export function attachmentUrl(id: string) {
  return `/api/docs/attachments/${id}`;
}

/** 解析站内附件地址 `/api/docs/attachments/<uuid>`（可选 `?download=1`），不是附件地址返回 null */
export function parseAttachmentUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  const m = /^\/api\/docs\/attachments\/([0-9a-f-]{36})(?:\?download=1)?$/i.exec(src);
  return m ? m[1] : null;
}

export function sanitizeFileName(name: string | null | undefined) {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\x00-\x1f]/g, "").trim().slice(0, 200);
  return clean || "未命名文件";
}

const TEXT_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
const OOXML_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const head = (b: Uint8Array, bytes: number[]) => bytes.every((v, i) => b[i] === v);

/** 按字节签名识别附件类型；不支持的类型（SVG/HTML/可执行文件等）返回 null */
export function sniffMediaType(bytes: Uint8Array, fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (head(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (head(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (head(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (head(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (head(bytes, [0x50, 0x4b, 0x03, 0x04])) return OOXML_EXT[ext] ?? "application/zip";
  if (ext in TEXT_EXT) {
    if (bytes.includes(0)) return null;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
    return `${TEXT_EXT[ext]}; charset=utf-8`;
  }
  return null;
}

/** 写文件（tmp + rename）后建库行；建行失败时尽力删除已写文件 */
export async function storeAttachment(
  input: { bytes: Uint8Array; fileName: string; spaceId: string; documentId?: string | null; userId: string },
  client: DbClient = db,
) {
  if (input.bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new Error("文件超过 10MB 大小限制");
  const fileName = sanitizeFileName(input.fileName);
  const mediaType = sniffMediaType(input.bytes, fileName);
  if (!mediaType) throw new Error("不支持的文件类型");
  const id = randomUUID();
  const dir = attachmentDir();
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${id}.tmp-${randomUUID()}`);
  await writeFile(tmp, input.bytes);
  await rename(tmp, attachmentPath(id));
  try {
    return await client.documentAttachment.create({
      data: {
        id,
        spaceId: input.spaceId,
        documentId: input.documentId ?? null,
        fileName,
        mediaType,
        size: input.bytes.byteLength,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        createdById: input.userId,
      },
    });
  } catch (e) {
    await unlink(attachmentPath(id)).catch(() => {});
    throw e;
  }
}

export { UUID_RE as ATTACHMENT_ID_RE };
