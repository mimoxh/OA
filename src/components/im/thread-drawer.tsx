"use client";

import { useEffect, useRef } from "react";
import { MessageSquareText, X } from "lucide-react";
import type { ConversationDTO, UserLite } from "@/lib/im/types";
import { loadOlderThread, loadThread, useThread } from "./store";
import { MessageItem } from "./message-item";
import { Composer } from "./composer";
import { MOBILE_DRAWER } from "./drawer";
import { cn } from "@/lib/utils";

const GROUP_MS = 5 * 60 * 1000;

export function ThreadDrawer({
  conv,
  me,
  rootId,
  onClose,
}: {
  conv: ConversationDTO;
  me: UserLite;
  rootId: string;
  onClose: () => void;
}) {
  const ts = useThread(rootId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  useEffect(() => {
    prevLenRef.current = 0;
    void loadThread(conv.id, rootId);
  }, [conv.id, rootId]);

  const items = ts?.items ?? [];
  const root = ts?.root ?? null;

  useEffect(() => {
    if (items.length > prevLenRef.current) {
      const box = scrollRef.current;
      if (box) {
        requestAnimationFrame(() => {
          box.scrollTop = box.scrollHeight;
        });
      }
    }
    prevLenRef.current = items.length;
  }, [items.length]);

  return (
    <aside className={cn("flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-canvas", MOBILE_DRAWER)}>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-4">
        <div className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          <MessageSquareText className="size-4 text-accent" />
          <span>话题</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label="关闭话题">
          <X className="size-4 max-md:size-5" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
        {ts?.loading && !root && (
          <div className="flex h-24 items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        )}

        {root && (
          <div className="border-b border-line bg-white/80 pb-3">
            <MessageItem msg={root} conv={conv} me={me} grouped={false} inThread />
          </div>
        )}

        {root && (
          <div className="mx-3 my-2.5 flex items-center gap-2 text-xs text-ink-3">
            <span>{root.threadCount > 0 ? `${root.threadCount} 条回复` : "暂无回复"}</span>
            <div className="h-px flex-1 bg-line" />
          </div>
        )}

        {ts?.hasMore && (
          <div className="py-1 text-center">
            <button
              type="button"
              onClick={() => void loadOlderThread(conv.id, rootId)}
              disabled={ts.loading}
              className="text-xs text-accent hover:underline disabled:opacity-50"
            >
              {ts.loading ? "加载中…" : "加载更早回复"}
            </button>
          </div>
        )}

        {items.map((m, i) => {
          const prev = items[i - 1];
          const grouped =
            !!prev &&
            prev.type !== "SYSTEM" &&
            !prev.recalled &&
            m.type !== "SYSTEM" &&
            prev.sender?.id === m.sender?.id &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
          return <MessageItem key={m.id} msg={m} conv={conv} me={me} grouped={grouped} inThread />;
        })}
      </div>

      {conv.type !== "BOT" && <Composer conv={conv} me={me} threadRootId={rootId} compact />}
    </aside>
  );
}
