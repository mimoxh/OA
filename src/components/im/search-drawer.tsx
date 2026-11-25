"use client";

import { useEffect, useState, type ReactNode } from "react";
import { File as FileIcon, Image as ImageIcon, Link2, MessageSquareText, Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { ConversationDTO, MessageSearchHit } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { useGroupMembers } from "./store";
import { convTime } from "./time";
import { MOBILE_DRAWER } from "./drawer";

type SearchKind = "all" | "image" | "file" | "link";

const KINDS: { key: SearchKind; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "image", label: "图片" },
  { key: "file", label: "文件" },
  { key: "link", label: "链接" },
];

function highlightText(text: string, q: string): ReactNode {
  const kw = q.trim();
  if (!kw) return text;
  const idx = text.toLowerCase().indexOf(kw.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-200/80 px-0.5 text-ink">{text.slice(idx, idx + kw.length)}</mark>
      {text.slice(idx + kw.length)}
    </>
  );
}

export function SearchDrawer({
  conv,
  onSelectHit,
  onClose,
}: {
  conv: ConversationDTO;
  onSelectHit: (hit: MessageSearchHit) => void;
  onClose: () => void;
}) {
  const members = useGroupMembers(conv.id);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<SearchKind>("all");
  const [senderId, setSenderId] = useState("");
  const [items, setItems] = useState<MessageSearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const hasFilter = q.trim().length > 0 || kind !== "all" || senderId.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!hasFilter) {
        setItems([]);
        setHasMore(false);
        setSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ kind, limit: "30" });
        if (q.trim()) params.set("q", q.trim());
        if (senderId) params.set("senderId", senderId);
        const res = await fetch(`/api/im/conversations/${conv.id}/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: MessageSearchHit[]; hasMore: boolean };
        setItems(data.items ?? []);
        setHasMore(Boolean(data.hasMore));
        setSearched(true);
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setItems([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [conv.id, q, kind, senderId, hasFilter]);

  const loadMore = async () => {
    if (loading || !hasMore || !items.length) return;
    const before = items[items.length - 1].seq;
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind, limit: "30", before: String(before) });
      if (q.trim()) params.set("q", q.trim());
      if (senderId) params.set("senderId", senderId);
      const res = await fetch(`/api/im/conversations/${conv.id}/search?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: MessageSearchHit[]; hasMore: boolean };
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setHasMore(Boolean(data.hasMore));
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className={cn("flex h-full w-[340px] shrink-0 flex-col border-l border-line bg-sidebar", MOBILE_DRAWER)}>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-4">
        <div className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          <Search className="size-4 text-accent" />
          <span>查找聊天记录</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label="关闭搜索">
          <X className="size-4 max-md:size-5" />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-line bg-white px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索消息关键词…"
            className="h-8 w-full rounded-md border border-line-strong bg-white pl-8 pr-7 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:text-ink"
              aria-label="清空"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                kind === k.key ? "bg-accent text-white" : "bg-sidebar text-ink-2 hover:bg-hover",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        {conv.type === "GROUP" && members && members.length > 0 && (
          <select
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
            className="h-7 w-full rounded-md border border-line-strong bg-white px-2 text-xs text-ink focus:border-accent focus:outline-none"
          >
            <option value="">全部发送人</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!hasFilter && (
          <div className="px-4 py-10 text-center text-xs text-ink-3">输入关键词，或按图片 / 文件 / 链接筛选</div>
        )}
        {loading && !items.length && (
          <div className="flex h-20 items-center justify-center">
            <span className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        )}
        {hasFilter && searched && !loading && items.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-ink-3">未找到匹配消息</div>
        )}

        <div className="flex flex-col gap-1">
          {items.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => onSelectHit(hit)}
              className="flex w-full items-start gap-2 rounded-lg border border-transparent bg-white p-2.5 text-left transition-colors hover:border-line hover:bg-hover/60"
            >
              <Avatar
                name={hit.sender?.name ?? conv.name}
                color={hit.sender?.avatarColor ?? conv.avatarColor}
                size={28}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink">{hit.sender?.name ?? conv.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{convTime(hit.createdAt)}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 break-words text-[13px] text-ink-2">
                  {hit.type === "IMAGE" && <ImageIcon className="mr-1 inline size-3.5 text-ink-3" />}
                  {hit.type === "FILE" && <FileIcon className="mr-1 inline size-3.5 text-ink-3" />}
                  {kind === "link" && <Link2 className="mr-1 inline size-3.5 text-accent" />}
                  {highlightText(hit.text || "[消息]", q)}
                </div>
                {hit.threadRootId && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                    <MessageSquareText className="size-2.5" />
                    话题回复
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {hasMore && (
          <div className="py-2 text-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
              className="text-xs text-accent hover:underline disabled:opacity-50"
            >
              {loading ? "加载中…" : "加载更多"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
