"use client";

import { useEffect, useState } from "react";
import { AtSign, Check, ChevronDown, RotateCcw, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { useAction } from "@/components/ui/use-action";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addComment, deleteComment, setCommentResolved } from "@/app/(app)/docs/actions";
import type { CommentReply, CommentThread, Member } from "./types";

export type PendingSelection = { from: number; to: number; quote: string };

type SubmitFn = (text: string, mentionIds: string[]) => void;

/** 评论输入框：支持 @ 成员（@名字 会在提交时解析为 mentionIds） */
function Composer({
  members,
  autoFocus,
  compact,
  placeholder = "发表评论…",
  submitText = "评论",
  onSubmit,
  onCancel,
}: {
  members: Member[];
  autoFocus?: boolean;
  compact?: boolean;
  placeholder?: string;
  submitText?: string;
  onSubmit: SubmitFn;
  onCancel?: () => void;
}) {
  const { pending } = useAction();
  const [v, setV] = useState("");
  const [active, setActive] = useState(!!autoFocus);
  const submit = () => {
    const text = v.trim();
    if (!text) return;
    const ids = members.filter((m) => v.includes(`@${m.name}`)).map((m) => m.id);
    onSubmit(text, ids);
    setV("");
    if (!autoFocus) setActive(false);
  };
  return (
    <div>
      <textarea
        autoFocus={autoFocus}
        rows={compact && !active ? 1 : 3}
        value={v}
        onFocus={() => setActive(true)}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setV("");
            onCancel?.();
          }
        }}
        placeholder={placeholder}
        className={cn(
          "w-full resize-none rounded-md border border-line-strong bg-white px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent focus:ring-[3px] focus:ring-accent/15",
          compact && !active && "h-9 overflow-hidden",
        )}
      />
      {(active || v) && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="提及成员"
                className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-3 hover:bg-hover hover:text-ink-2"
              >
                <AtSign className="size-3.5" />
                提及
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-1">
              <div className="max-h-56 overflow-y-auto">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setV((x) => x + (x && !x.endsWith(" ") ? " " : "") + `@${m.name} `)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover"
                  >
                    <Avatar name={m.name} color={m.avatarColor} size={20} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.name}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <span className="ml-auto flex items-center gap-1.5">
            {onCancel && (
              <button type="button" onClick={onCancel} className="h-7 rounded px-2 text-[13px] text-ink-2 hover:bg-hover">
                取消
              </button>
            )}
            <button
              type="button"
              disabled={!v.trim() || pending}
              onClick={submit}
              className="h-7 rounded bg-accent px-2.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {submitText}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function QuoteBlock({ quote }: { quote: string }) {
  return (
    <div className="mb-1.5 border-l-2 border-tag-yellow-ink/40 pl-2 text-xs italic leading-relaxed text-ink-2 line-clamp-3">
      {quote}
    </div>
  );
}

function AuthorLine({ author, createdAt }: { author: CommentReply["author"]; createdAt: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Avatar name={author.name} color={author.avatarColor} size={18} />
      <span className="text-[13px] font-medium text-ink">{author.name}</span>
      <span className="text-[11px] text-ink-3">{formatRelative(createdAt)}</span>
    </div>
  );
}

export function CommentsPanel({
  docId,
  threads,
  members,
  meId,
  canEdit,
  canAdmin,
  pendingSel,
  focusThread,
  onSelectionDone,
  onChanged,
  onClose,
}: {
  docId: string;
  threads: CommentThread[];
  members: Member[];
  meId: string;
  /** 可编辑者可解决/重新打开任何线程 */
  canEdit: boolean;
  /** 管理员可删除任何人的评论 */
  canAdmin: boolean;
  pendingSel: PendingSelection | null;
  focusThread: string | null;
  /** 划词评论提交成功（id）或取消（null）后回调，用于给选区打评论 mark */
  onSelectionDone: (id: string | null) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (!focusThread) return;
    const t = window.setTimeout(() => {
      document.getElementById(`comment-thread-${focusThread}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusThread, threads]);

  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);
  const canResolve = (t: CommentThread) => t.author.id === meId || canEdit;
  const canDelete = (authorId: string) => authorId === meId || canAdmin;

  const post = (input: { content: string; mentionIds: string[]; quote?: string | null; parentId?: string }, isSelection?: boolean) =>
    run(() => addComment({ documentId: docId, ...input }), {
      success: "已评论",
      onSuccess: (d) => {
        if (isSelection) onSelectionDone(d.id);
        onChanged();
      },
    });

  const threadCard = (t: CommentThread) => (
    <div
      key={t.id}
      id={`comment-thread-${t.id}`}
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-shadow",
        focusThread === t.id ? "border-accent/60 shadow-[0_0_0_3px_rgba(35,131,226,0.12)]" : "border-line",
        t.resolved && "opacity-60",
      )}
    >
      {t.quote && <QuoteBlock quote={t.quote} />}
      <div className="flex items-start justify-between gap-2">
        <AuthorLine author={t.author} createdAt={t.createdAt} />
        <div className="flex shrink-0 items-center gap-0.5">
          {canResolve(t) &&
            (t.resolved ? (
              <button
                type="button"
                title="重新打开"
                onClick={() => run(() => setCommentResolved({ id: t.id, resolved: false }), { onSuccess: onChanged })}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-2 hover:bg-hover"
              >
                <RotateCcw className="size-3" />
                重开
              </button>
            ) : (
              <button
                type="button"
                title="标记为已解决"
                onClick={() => run(() => setCommentResolved({ id: t.id, resolved: true }), { success: "已解决", onSuccess: onChanged })}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-2 hover:bg-hover"
              >
                <Check className="size-3" />
                解决
              </button>
            ))}
          {canDelete(t.author.id) && (
            <button
              type="button"
              title="删除评论"
              onClick={() => run(() => deleteComment(t.id), { success: "已删除", onSuccess: onChanged })}
              className="flex size-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-danger"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{t.content}</p>

      {t.replies.length > 0 && (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          {t.replies.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <AuthorLine author={r.author} createdAt={r.createdAt} />
                <p className="mt-0.5 whitespace-pre-wrap pl-6 text-[13px] leading-relaxed text-ink">{r.content}</p>
              </div>
              {canDelete(r.author.id) && (
                <button
                  type="button"
                  title="删除回复"
                  onClick={() => run(() => deleteComment(r.id), { success: "已删除", onSuccess: onChanged })}
                  className="mt-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-danger"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!t.resolved && (
        <div className="mt-2 border-t border-line pt-2">
          <Composer
            members={members}
            compact
            placeholder="回复…"
            submitText="回复"
            onSubmit={(content, mentionIds) => post({ content, mentionIds, parentId: t.id })}
          />
        </div>
      )}
    </div>
  );

  return (
    <aside className="sticky top-11 flex h-[calc(100vh-2.75rem)] w-[330px] shrink-0 flex-col border-l border-line bg-white max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:h-screen max-lg:shadow-pop">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[13px] font-semibold text-ink">
          评论{open.length > 0 && <span className="ml-1 font-normal text-ink-3">{open.length} 待解决</span>}
        </span>
        <button type="button" onClick={onClose} className="flex size-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {pendingSel && (
          <div className="rounded-lg border border-accent/50 bg-accent-soft/40 px-3 py-2.5">
            <QuoteBlock quote={pendingSel.quote} />
            <Composer
              members={members}
              autoFocus
              placeholder="对所选内容发表评论…"
              onSubmit={(content, mentionIds) => post({ content, mentionIds, quote: pendingSel.quote }, true)}
              onCancel={() => onSelectionDone(null)}
            />
          </div>
        )}
        <Composer members={members} placeholder="添加页面评论…（Ctrl+Enter 发送）" onSubmit={(content, mentionIds) => post({ content, mentionIds })} />

        {open.map(threadCard)}
        {resolved.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowResolved((v) => !v)}
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-xs text-ink-3 hover:bg-hover"
            >
              <ChevronDown className={cn("size-3 transition-transform", !showResolved && "-rotate-90")} />
              已解决（{resolved.length}）
            </button>
            {showResolved && <div className="mt-2 space-y-3">{resolved.map(threadCard)}</div>}
          </div>
        )}
        {threads.length === 0 && !pendingSel && (
          <p className="px-1 py-6 text-center text-[13px] text-ink-3">还没有评论，选中文字或直接在上方输入</p>
        )}
      </div>
      {pending && <div className="pointer-events-none absolute inset-0" />}
    </aside>
  );
}
