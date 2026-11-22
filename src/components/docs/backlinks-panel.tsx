"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, GitFork, Link2, RefreshCw } from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { BacklinkItem, BacklinksResult } from "@/lib/docs/links";
import { cn } from "@/lib/utils";

type Props = {
  docId: string;
  initialLinks: BacklinkItem[];
  initialTruncated: boolean;
  onOpenGraph?: () => void;
};

export function BacklinksPanel({ docId, initialLinks, initialTruncated, onOpenGraph }: Props) {
  const [links, setLinks] = useState<BacklinkItem[]>(initialLinks);
  const [truncated, setTruncated] = useState(initialTruncated);
  const [open, setOpen] = useState(initialLinks.length > 0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/backlinks`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as BacklinksResult;
      setLinks(data.links ?? []);
      setTruncated(!!data.truncated);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  // 按源页面聚合展示，同时保留每条引用的段落上下文摘要
  const grouped = (() => {
    const map = new Map<
      string,
      {
        sourceDocId: string;
        sourceTitle: string;
        sourceIcon: string | null;
        spaceName: string;
        spaceIcon: string;
        updatedAt: string;
        snippets: { id: string; text: string }[];
      }
    >();
    for (const item of links) {
      let group = map.get(item.sourceDocId);
      if (!group) {
        group = {
          sourceDocId: item.sourceDocId,
          sourceTitle: item.sourceTitle,
          sourceIcon: item.sourceIcon,
          spaceName: item.spaceName,
          spaceIcon: item.spaceIcon,
          updatedAt: item.updatedAt,
          snippets: [],
        };
        map.set(item.sourceDocId, group);
      }
      if (item.snippet) group.snippets.push({ id: item.id, text: item.snippet });
    }
    return [...map.values()];
  })();

  return (
    <section className="mt-10">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[13px] font-semibold text-ink-3 hover:bg-hover hover:text-ink-2"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Link2 className="size-3.5" />
          <span>反向链接</span>
          <span className="rounded-full bg-hover px-1.5 py-0.2 text-[11px] font-medium text-ink-2">
            {links.length}
            {truncated ? "+" : ""}
          </span>
        </button>

        <div className="flex items-center gap-1">
          {onOpenGraph && (
            <button
              type="button"
              onClick={onOpenGraph}
              className="flex h-6 items-center gap-1 rounded px-2 text-xs text-ink-3 hover:bg-hover hover:text-ink"
              title="在关系图中查看当前页面的关联网络"
            >
              <GitFork className="size-3.5" />
              局部关系图
            </button>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex size-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-50"
            title="刷新反向链接"
            aria-label="刷新反向链接"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {open && (
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          {grouped.length === 0 ? (
            <div className="px-3.5 py-4 text-[13px] text-ink-3">
              暂无其他页面引用本页。在其他文档中输入 <code className="rounded bg-hover px-1 py-0.5 text-xs text-ink-2">[[</code>{" "}
              即可快速链接到此页面。
            </div>
          ) : (
            <div className="divide-y divide-line">
              {grouped.map((g) => (
                <Link
                  key={g.sourceDocId}
                  href={`/docs/${g.sourceDocId}`}
                  className="block px-3.5 py-2.5 transition-colors hover:bg-hover/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-base leading-none">{g.sourceIcon || "📄"}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{g.sourceTitle}</span>
                    <span className="hidden shrink-0 rounded bg-sidebar px-1.5 py-0.5 text-[11px] text-ink-3 sm:inline-block">
                      {g.spaceIcon} {g.spaceName}
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{formatRelative(g.updatedAt)}</span>
                  </div>
                  {g.snippets.length > 0 && (
                    <div className="mt-1.5 space-y-1 pl-6">
                      {g.snippets.slice(0, 3).map((s) => (
                        <p key={s.id} className="line-clamp-2 text-xs leading-relaxed text-ink-2">
                          {s.text}
                        </p>
                      ))}
                      {g.snippets.length > 3 && (
                        <p className="text-[11px] text-ink-3">另有 {g.snippets.length - 3} 处引用</p>
                      )}
                    </div>
                  )}
                </Link>
              ))}
              {truncated && (
                <div className="bg-sidebar/70 px-3.5 py-2 text-xs text-ink-3">
                  反向链接较多，当前仅显示最近更新的前 100 条引用。
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
