import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, type DbClient } from "@/lib/db";
import { sniffMediaType } from "./attachment-types";

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

export { sniffMediaType };

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
