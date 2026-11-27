"use client";

import { useEffect, useState } from "react";
import type { PreviewFailure } from "@/lib/file-preview/sniff";

export type BytesState =
  | { kind: "loading"; loaded: number; total: number }
  | { kind: "ready"; bytes: Uint8Array; truncated: boolean; total: number }
  | { kind: "error"; failure: PreviewFailure };

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export function httpFailure(e: unknown): PreviewFailure {
  if (e instanceof HttpError) {
    if (e.status === 401) return { title: "登录已失效", detail: "请重新登录后再预览。" };
    if (e.status === 403 || e.status === 404) return { title: "文件不可用", detail: "文件不存在或你没有权限查看。" };
    return { title: "文件加载失败", detail: `服务器返回 HTTP ${e.status}，请稍后重试或下载查看。` };
  }
  if ((e as Error)?.name === "AbortError") return { title: "已取消", detail: "" };
  return { title: "文件加载失败", detail: "网络连接中断，请稍后重试或下载查看。" };
}

/**
 * 读取文件内容（同源请求，带登录 Cookie）。limit 表示只需要开头 limit 字节：
 * 优先用 Range 只取这一段，服务端不支持时边读边截断。
 */
export async function fetchBytes(
  src: string,
  opts: { limit?: number; size?: number; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<{ bytes: Uint8Array; truncated: boolean; total: number }> {
  const { limit, size, signal, onProgress } = opts;
  const wantPart = limit != null && (size == null || size > limit);
  const res = await fetch(src, {
    credentials: "same-origin",
    signal,
    headers: wantPart ? { Range: `bytes=0-${limit - 1}` } : undefined,
  });
  if (!res.ok) throw new HttpError(res.status);
  const total = (() => {
    const cr = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
    if (cr) return Number(cr[1]);
    return Number(res.headers.get("content-length")) || size || 0;
  })();
  const cap = limit ?? Infinity;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf.length > cap ? buf.subarray(0, cap) : buf, truncated: buf.length > cap || total > buf.length, total };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, Math.min(total || loaded, cap));
    if (loaded >= cap) {
      truncated = loaded > cap || total > cap;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const n = Math.min(loaded, cap);
  const out = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, n - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= n) break;
  }
  return { bytes: out, truncated: truncated || (total > 0 && total > n), total: total || n };
}

/** 按需读取 [start, end) 字节（ZIP 目录用）。服务端不支持 Range 时退化为整份下载一次后切片 */
export function rangeReader(src: string, signal?: AbortSignal) {
  let whole: Promise<Uint8Array> | null = null;
  return async (start: number, end: number): Promise<Uint8Array> => {
    if (whole) return (await whole).subarray(start, end);
    const res = await fetch(src, { credentials: "same-origin", signal, headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!res.ok) throw new HttpError(res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (res.status === 206) return buf;
    whole = Promise.resolve(buf);
    return buf.subarray(start, end);
  };
}

export function useFileBytes(src: string, opts: { limit?: number; size?: number }) {
  const { limit, size } = opts;
  const [state, setState] = useState<BytesState>({ kind: "loading", loaded: 0, total: size ?? 0 });
  useEffect(() => {
    const ac = new AbortController();
    let last = -1;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "loading", loaded: 0, total: size ?? 0 });
    fetchBytes(src, {
      limit,
      size,
      signal: ac.signal,
      onProgress: (loaded, total) => {
        const pct = total ? Math.floor((loaded / total) * 50) : Math.floor(loaded / 262144);
        if (pct === last) return;
        last = pct;
        setState({ kind: "loading", loaded, total });
      },
    }).then(
      (r) => !ac.signal.aborted && setState({ kind: "ready", ...r }),
      (e) => !ac.signal.aborted && setState({ kind: "error", failure: httpFailure(e) }),
    );
    return () => ac.abort();
  }, [src, limit, size]);
  return state;
}
