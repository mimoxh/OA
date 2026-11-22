"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import type { RefPreview, RefType } from "@/lib/im/types";
import { cn } from "@/lib/utils";

// 引用预览缓存 + 批量请求（~50ms 聚合，单次最多 20 条）
const cache = new Map<string, RefPreview | "loading">();
const queue = new Map<string, { type: RefType; id: string }>();
const waiters = new Map<string, Set<() => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function key(r: { type: RefType; id: string }) {
  return `${r.type}:${r.id}`;
}

function flush() {
  timer = null;
  const batch = [...queue.values()].slice(0, 20);
  for (const k of [...queue.keys()].slice(0, 20)) queue.delete(k);
  if (!batch.length) return;
  void fetch("/api/im/refs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refs: batch }),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d: { previews: RefPreview[] }) => {
      const byKey = new Map(d.previews.map((p) => [key(p), p]));
      for (const ref of batch) {
        cache.set(key(ref), byKey.get(key(ref)) ?? ({ ...ref, ok: false, reason: "not_found" } as RefPreview));
      }
    })
    .catch(() => {
      for (const ref of batch) cache.delete(key(ref));
    })
    .finally(() => {
      for (const ref of batch) {
        for (const w of waiters.get(key(ref)) ?? []) w();
        waiters.delete(key(ref));
      }
      if (queue.size) timer = setTimeout(flush, 50);
    });
}

export function useRefPreview(r: { type: RefType; id: string }): RefPreview | null | undefined {
  const k = key(r);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!cache.has(k)) {
      cache.set(k, "loading");
      queue.set(k, r);
      if (!timer) timer = setTimeout(flush, 50);
    }
    // 无论是否新入队都要挂 waiter：StrictMode 下首轮 cleanup 会清掉首次注册的回调
    const fn = () => bump((n) => n + 1);
    let w = waiters.get(k);
    if (!w) {
      w = new Set();
      waiters.set(k, w);
    }
    w.add(fn);
    return () => {
      w!.delete(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  const v = cache.get(k);
  return v === "loading" ? undefined : (v ?? null);
}

const STATUS_CLS: Record<string, string> = {
  blue: "bg-tag-blue text-tag-blue-ink",
  green: "bg-tag-green text-tag-green-ink",
  red: "bg-tag-red text-tag-red-ink",
  orange: "bg-tag-orange text-tag-orange-ink",
  gray: "bg-tag-gray text-tag-gray-ink",
};

/** 单条业务引用卡片：ok → 可点击预览；forbidden → 灰条；not_found → 不渲染 */
export function RefPreviewCard({ r, mine }: { r: { type: RefType; id: string }; mine?: boolean }) {
  const p = useRefPreview(r);
  if (p === undefined) {
    return <div className={cn("mt-1 h-10 w-72 max-w-full animate-pulse rounded-md", mine ? "bg-white/40" : "bg-hover")} />;
  }
  if (!p || !p.ok) {
    if (p?.reason === "forbidden") {
      return (
        <div className="mt-1 flex w-72 max-w-full items-center gap-1.5 rounded-md border border-line bg-sidebar px-2.5 py-2 text-xs text-ink-3">
          <LockKeyhole className="size-3.5" />
          无权限查看该内容
        </div>
      );
    }
    return null;
  }
  return (
    <Link
      href={p.href}
      className="mt-1 block w-80 max-w-full rounded-md border border-line bg-white p-2.5 shadow-card transition-shadow hover:shadow-pop"
    >
      <div className="flex items-start gap-2">
        {p.icon && <span className="mt-0.5 text-base leading-none">{p.icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{p.title}</span>
            {p.status && (
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", STATUS_CLS[p.status.color] ?? STATUS_CLS.gray)}>
                {p.status.label}
              </span>
            )}
          </div>
          {p.subtitle && <div className="mt-0.5 truncate text-xs text-ink-2">{p.subtitle}</div>}
          {!!p.fields?.length && (
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              {p.fields.slice(0, 3).map((f, i) => (
                <div key={i} className="truncate text-xs text-ink-2">
                  <span className="text-ink-3">{f.label}：</span>
                  {f.value}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
