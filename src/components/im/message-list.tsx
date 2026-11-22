"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { isSameDay, isToday, isYesterday, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { ConversationDTO, MessageDTO, UserLite } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import {
  discardPending,
  loadMessages,
  loadMessagesAround,
  loadOlder,
  markRead,
  reloadLatestMessages,
  retryPending,
  useConvMessages,
  useGroupMembers,
  useTypingIds,
} from "./store";
import { MessageItem, PendingItem } from "./message-item";

const GROUP_MS = 5 * 60 * 1000;

function dayLabel(d: Date) {
  if (isToday(d)) return "今天";
  if (isYesterday(d)) return "昨天";
  return format(d, "M月d日", { locale: zhCN });
}

export function MessageList({
  conv,
  me,
  onReply,
  onOpenThread,
  focusSeq = null,
  onClearFocusSeq,
}: {
  conv: ConversationDTO;
  me: UserLite;
  onReply: (msg: MessageDTO) => void;
  onOpenThread: (msg: MessageDTO) => void;
  focusSeq?: number | null;
  onClearFocusSeq?: () => void;
}) {
  const ms = useConvMessages(conv.id);
  const typingIds = useTypingIds(conv.id);
  const members = useGroupMembers(conv.id);
  const boxRef = useRef<HTMLDivElement>(null);
  const [newCount, setNewCount] = useState(0);
  const [highlightedSeq, setHighlightedSeq] = useState<number | null>(null);

  // 打开时的已读位置（未读分隔线固定在这里）
  const [readAtOpen] = useState(conv.lastReadSeq);

  const prependAnchor = useRef<number | null>(null);
  const didInit = useRef(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeqRef = useRef(0);
  const prevCount = useRef(0);

  useEffect(() => {
    if (focusSeq != null) return;
    void loadMessages(conv.id);
  }, [conv.id, focusSeq]);

  // 定位并高亮某条消息（来自搜索跳转或 URL ?seq=）
  useEffect(() => {
    if (focusSeq == null) return;
    let cancelled = false;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const found = await loadMessagesAround(conv.id, focusSeq);
      if (cancelled) return;
      didInit.current = true;
      if (found) {
        requestAnimationFrame(() => {
          const el = boxRef.current?.querySelector(`[data-seq="${focusSeq}"]`);
          el?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
        setHighlightedSeq(focusSeq);
        clearTimer = setTimeout(() => setHighlightedSeq(null), 2400);
      }
      onClearFocusSeq?.();
    })();
    return () => {
      cancelled = true;
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [conv.id, focusSeq, onClearFocusSeq]);

  const items = ms?.items;
  const pending = ms?.pending;
  const hasNewer = Boolean(ms?.hasNewer);

  const scrollBottom = useCallback((smooth = false) => {
    const box = boxRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewCount(0);
  }, []);

  // 初次加载：滚到未读分隔线或底部
  useLayoutEffect(() => {
    if (didInit.current || !items?.length || focusSeq != null) return;
    didInit.current = true;
    requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      const divider = box.querySelector("[data-unread]");
      if (divider) divider.scrollIntoView({ block: "start" });
      else box.scrollTop = box.scrollHeight;
    });
  }, [items, focusSeq]);

  // 向上翻页后保持视口位置
  useLayoutEffect(() => {
    if (prependAnchor.current == null || !items?.length) return;
    const box = boxRef.current;
    if (!box) return;
    box.scrollTop += box.scrollHeight - prependAnchor.current;
    prependAnchor.current = null;
  }, [items]);

  // 新消息：近底部自动滚动，否则计数 pill；自己发的始终滚到底
  useEffect(() => {
    if (hasNewer) return;
    const itemsNow = items ?? [];
    const count = itemsNow.length + (pending?.length ?? 0);
    if (count <= prevCount.current) {
      prevCount.current = count;
      return;
    }
    const last = itemsNow[itemsNow.length - 1];
    const grewNew = !!last && last.seq > lastSeqRef.current;
    if (last) lastSeqRef.current = Math.max(lastSeqRef.current, last.seq);
    const ownPending = (pending?.length ?? 0) > prevCount.current - itemsNow.length;
    prevCount.current = count;
    const box = boxRef.current;
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (ownPending || near || !grewNew) {
      const raf = requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight;
        setNewCount(0);
      });
      return () => cancelAnimationFrame(raf);
    } else if (last.sender?.id !== me.id) {
      const raf = requestAnimationFrame(() => setNewCount((n) => n + 1));
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [items, pending, me.id, hasNewer]);

  const maybeMarkRead = useCallback(() => {
    if (hasNewer) return;
    const box = boxRef.current;
    if (!box || document.hidden || !document.hasFocus()) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight > 8) return;
    const c = conv;
    if (c.lastSeq <= c.lastReadSeq) return;
    const seq = c.lastSeq;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => markRead(c.id, seq), 500);
  }, [conv, hasNewer]);

  useEffect(() => {
    maybeMarkRead();
    const onFocus = () => maybeMarkRead();
    const onVis = () => !document.hidden && maybeMarkRead();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [maybeMarkRead]);

  const onScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 8) setNewCount(0);
    if (box.scrollTop < 80 && ms?.hasMore && !ms.loading) {
      prependAnchor.current = box.scrollHeight;
      void loadOlder(conv.id);
    }
    maybeMarkRead();
  };

  // 未读分隔线位置
  const dividerSeq = useMemo(() => items?.find((m) => m.seq > readAtOpen)?.seq ?? null, [items, readAtOpen]);

  const typingNames = useMemo(() => {
    return typingIds
      .filter((id) => id !== me.id)
      .map((id) => members?.find((m) => m.id === id)?.name ?? (conv.type === "DIRECT" ? conv.name : "对方"));
  }, [typingIds, members, me.id, conv.type, conv.name]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={boxRef} onScroll={onScroll} className="h-full overflow-y-auto bg-canvas pb-4">
        {ms?.loading && !items?.length && (
          <div className="flex h-24 items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        )}
        {ms?.hasMore && (
          <div className="py-2 text-center text-xs text-ink-3">{ms.loading ? "加载中…" : "下拉加载更早消息"}</div>
        )}
        {items?.map((m, i) => {
          const prev = items[i - 1];
          const d = new Date(m.createdAt);
          const daySep = !prev || !isSameDay(new Date(prev.createdAt), d);
          const grouped =
            !daySep &&
            !!prev &&
            prev.type !== "SYSTEM" &&
            !prev.recalled &&
            m.type !== "SYSTEM" &&
            prev.sender?.id === m.sender?.id &&
            d.getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
          return (
            <div key={m.id}>
              {daySep && (
                <div className="px-4 pb-1 pt-4 text-center text-xs text-ink-3">{dayLabel(d)}</div>
              )}
              {dividerSeq === m.seq && !hasNewer && (
                <div data-unread className="mx-4 mt-3 flex items-center gap-3">
                  <div className="h-px flex-1 bg-tag-red" />
                  <span className="text-xs text-danger">以下为新消息</span>
                  <div className="h-px flex-1 bg-tag-red" />
                </div>
              )}
              <MessageItem
                msg={m}
                conv={conv}
                me={me}
                grouped={grouped}
                onReply={onReply}
                members={members}
                onOpenThread={onOpenThread}
                highlighted={highlightedSeq === m.seq}
              />
            </div>
          );
        })}
        {pending?.map((p) => (
          <PendingItem
            key={p.clientMsgId}
            text={p.text}
            failed={p.failed}
            onRetry={() => retryPending(conv.id, p.clientMsgId)}
            onDiscard={() => discardPending(conv.id, p.clientMsgId)}
          />
        ))}
      </div>
      {hasNewer ? (
        <button
          onClick={() =>
            void reloadLatestMessages(conv.id).then(() => {
              requestAnimationFrame(() => scrollBottom(true));
            })
          }
          className="absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-pop hover:bg-accent-hover"
        >
          <ArrowDown className="size-3.5" />
          回到最新消息
        </button>
      ) : (
        newCount > 0 && (
          <button
            onClick={() => scrollBottom(true)}
            className="absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-pop hover:bg-accent-hover"
          >
            <ArrowDown className="size-3.5" />
            {newCount} 条新消息
          </button>
        )
      )}
      <div className={cn("pointer-events-none absolute bottom-1 left-0 right-0 text-center text-xs text-ink-3 transition-opacity", typingNames.length ? "opacity-100" : "opacity-0")}>
        {typingNames.length > 0 && `${typingNames.slice(0, 3).join("、")} 正在输入…`}
      </div>
    </div>
  );
}
