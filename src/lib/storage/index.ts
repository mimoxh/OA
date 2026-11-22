import { randomUUID } from "node:crypto";
import path from "node:path";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";
import type { StorageDriver } from "./types";

export type { StorageDriver, StorageObject } from "./types";

const g = globalThis as unknown as { __oaStorage?: StorageDriver };

export function getStorage(): StorageDriver {
  if (g.__oaStorage) return g.__oaStorage;
  const driver = (process.env.STORAGE_DRIVER ?? (process.env.S3_BUCKET ? "s3" : "local")).toLowerCase();
  if (driver === "s3") {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("启用 S3 存储时必须配置 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY");
    }
    g.__oaStorage = new S3StorageDriver({
      endpoint,
      region: process.env.S3_REGION || "us-east-1",
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    });
  } else {
    const dir = process.env.STORAGE_LOCAL_DIR || path.resolve(process.cwd(), "data/uploads");
    g.__oaStorage = new LocalStorageDriver(dir);
  }
  return g.__oaStorage;
}

/** 清理文件名，仅保留可读部分并限制长度 */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name || "file").replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  return (base || "file").slice(0, 120);
}

/** 生成按年月分目录的对象存储 key */
export function makeStorageKey(prefix: string, filename: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  return `${prefix}/${ym}/${randomUUID()}${ext}`;
}

/** 允许内联展示的安全图片 MIME（不含 SVG，防止 XSS） */
export const SAFE_INLINE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** 通过文件魔数校验常见图片格式，防止伪造 MIME */
export function detectSafeImageMime(data: Uint8Array): string | null {
  if (data.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  // GIF: GIF87a / GIF89a
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return "image/gif";
  // WebP: RIFF....WEBP
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
