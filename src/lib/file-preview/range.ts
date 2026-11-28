/**
 * HTTP Range（单段）解析：让音视频能拖动进度条、大文件能分段读取。
 * 多段 Range 不支持，按普通 200 整份返回（RFC 9110 允许）。
 */

export type ByteRange = { start: number; end: number };

/** null：没有 Range 或不支持的写法，返回整份；"unsatisfiable"：返回 416 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null;
  const [, a, b] = m;
  if (!a && !b) return null;
  if (!a) {
    // bytes=-N：最后 N 字节
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n === 0) return "unsatisfiable";
    if (size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return "unsatisfiable";
  let end = b ? Number(b) : size - 1;
  if (!Number.isSafeInteger(end)) return null;
  if (end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

/** 组装文件响应：带 Accept-Ranges，按 Range 返回 206 / 416 / 200 */
export function rangeResponseInit(
  rangeHeader: string | null,
  size: number,
  headers: Record<string, string>,
): { status: 200 | 206 | 416; range: ByteRange | null; headers: Record<string, string> } {
  const r = parseRange(rangeHeader, size);
  const base = { ...headers, "Accept-Ranges": "bytes" };
  if (r === "unsatisfiable") {
    return { status: 416, range: null, headers: { ...base, "Content-Range": `bytes */${size}`, "Content-Length": "0" } };
  }
  if (!r) return { status: 200, range: null, headers: { ...base, "Content-Length": String(size) } };
  return {
    status: 206,
    range: r,
    headers: { ...base, "Content-Range": `bytes ${r.start}-${r.end}/${size}`, "Content-Length": String(r.end - r.start + 1) },
  };
}
