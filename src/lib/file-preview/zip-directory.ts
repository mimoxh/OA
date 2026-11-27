/**
 * 只读 ZIP 的中央目录（文件末尾的目录区），列出条目名称和大小，不解压任何内容：
 * 读取量只有目录区那几 KB，压缩炸弹（解压后极大）不会占用内存；条目数有上限。
 */

export type ZipEntry = {
  name: string;
  dir: boolean;
  size: number;
  compressedSize: number;
  encrypted: boolean;
};

export type ZipDirectory = {
  entries: ZipEntry[];
  /** 中央目录登记的条目总数 */
  total: number;
  /** 条目超过上限，只列出了前面一部分 */
  truncated: boolean;
  totalSize: number;
  totalCompressed: number;
  /** 解压后体积异常（可能是压缩炸弹） */
  suspicious: boolean;
  encrypted: boolean;
};

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

/** 读取 [start, end) 字节 */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;
const SUSPICIOUS_TOTAL = 2 * 1024 * 1024 * 1024;
const SUSPICIOUS_RATIO = 200;
const CD_READ_LIMIT = 8 * 1024 * 1024;

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
}
function u64(b: Uint8Array, o: number) {
  return u32(b, o) + u32(b, o + 4) * 0x100000000;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** 文件名：标记了 UTF-8 的按 UTF-8；没标记的先试 UTF-8，不合法再按 GB18030（Windows 中文系统打的包） */
export function decodeZipName(raw: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder("utf-8").decode(raw);
  try {
    return utf8.decode(raw);
  } catch {
    return new TextDecoder("gb18030").decode(raw);
  }
}

export async function readZipDirectory(read: RangeReader, size: number, maxEntries: number): Promise<ZipDirectory> {
  if (size < 22) throw new ZipFormatError("文件太小，不是有效的 ZIP");
  // 目录结束记录在最后 22 字节 + 最长 65535 字节的注释之内
  const tailStart = Math.max(0, size - 22 - 65535);
  const tail = await read(tailStart, size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("找不到 ZIP 目录结束记录");
  let total = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || u32(tail, loc) !== EOCD64_LOC_SIG) throw new ZipFormatError("ZIP64 定位记录缺失");
    const off64 = u64(tail, loc + 8);
    const rec = await read(off64, Math.min(size, off64 + 56));
    if (rec.length < 56 || u32(rec, 0) !== EOCD64_SIG) throw new ZipFormatError("ZIP64 目录结束记录损坏");
    total = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }
  if (cdOffset + cdSize > size) throw new ZipFormatError("ZIP 目录超出文件范围");
  // 目录区过大（几十万个条目）时只读前 8 MB，够列出 maxEntries 条
  const capped = cdSize > CD_READ_LIMIT;
  const cd = await read(cdOffset, cdOffset + Math.min(cdSize, CD_READ_LIMIT));
  const entries: ZipEntry[] = [];
  let p = 0;
  let totalSize = 0;
  let totalCompressed = 0;
  let anyEncrypted = false;
  let counted = 0;
  while (p + 46 <= cd.length && counted < total) {
    if (u32(cd, p) !== CEN_SIG) throw new ZipFormatError("ZIP 目录条目损坏");
    const flags = u16(cd, p + 8);
    let compressedSize = u32(cd, p + 20);
    let uncompressed = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    const nameStart = p + 46;
    if (nameStart + nameLen + extraLen > cd.length) {
      if (capped) break;
      throw new ZipFormatError("ZIP 目录条目截断");
    }
    const rawName = cd.subarray(nameStart, nameStart + nameLen);
    let name: string | null = null;
    // 扩展字段：0x0001 ZIP64 大小，0x7075 Info-ZIP Unicode 路径
    let x = nameStart + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(cd, x);
      const len = u16(cd, x + 2);
      const d = x + 4;
      if (id === 0x0001) {
        let q = d;
        if (uncompressed === 0xffffffff && q + 8 <= d + len) {
          uncompressed = u64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff && q + 8 <= d + len) compressedSize = u64(cd, q);
      } else if (id === 0x7075 && len > 5 && cd[d] === 1) {
        name = new TextDecoder("utf-8").decode(cd.subarray(d + 5, d + len));
      }
      x = d + len;
    }
    name ??= decodeZipName(rawName, (flags & 0x0800) !== 0);
    const encrypted = (flags & 0x0001) !== 0;
    const dir = name.endsWith("/") || name.endsWith("\\");
    totalSize += uncompressed;
    totalCompressed += compressedSize;
    anyEncrypted ||= encrypted;
    if (entries.length < maxEntries) {
      entries.push({ name: name.replace(/\\/g, "/"), dir, size: uncompressed, compressedSize, encrypted });
    }
    counted++;
    p = nameStart + nameLen + extraLen + commentLen;
  }
  return {
    entries,
    total: Math.max(total, counted),
    truncated: counted > entries.length || total > counted,
    totalSize,
    totalCompressed,
    suspicious: totalSize > SUSPICIOUS_TOTAL || (totalCompressed > 0 && totalSize / totalCompressed > SUSPICIOUS_RATIO && totalSize > 100 * 1024 * 1024),
    encrypted: anyEncrypted,
  };
}

export type ZipTreeRow = { path: string; name: string; depth: number; dir: boolean; size: number; encrypted: boolean };

/** 按路径排成目录树（文件夹在前、按名称排序），补上没有单独登记的中间文件夹 */
export function zipTreeRows(entries: ZipEntry[]): ZipTreeRow[] {
  type Node = { name: string; dir: boolean; size: number; encrypted: boolean; children: Map<string, Node> };
  const rootNode: Node = { name: "", dir: true, size: 0, encrypted: false, children: new Map() };
  for (const e of entries) {
    const parts = e.name.split("/").filter((s) => s && s !== "." && s !== "..");
    if (!parts.length) continue;
    let cur = rootNode;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      let next = cur.children.get(part);
      if (!next) {
        next = { name: part, dir: !last || e.dir, size: 0, encrypted: false, children: new Map() };
        cur.children.set(part, next);
      }
      if (last && !e.dir) {
        next.size = e.size;
        next.encrypted = e.encrypted;
      }
      cur = next;
    });
  }
  const rows: ZipTreeRow[] = [];
  const walk = (n: Node, depth: number, prefix: string) => {
    const kids = [...n.children.values()].sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "zh-CN") : a.dir ? -1 : 1));
    for (const k of kids) {
      const path = prefix ? `${prefix}/${k.name}` : k.name;
      rows.push({ path, name: k.name, depth, dir: k.dir, size: k.size, encrypted: k.encrypted });
      if (k.dir) walk(k, depth + 1, path);
    }
  };
  walk(rootNode, 0, "");
  return rows;
}
