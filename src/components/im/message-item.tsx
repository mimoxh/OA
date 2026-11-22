"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import {
  Check,
  CheckCheck,
  Copy,
  Download,
  File as FileIcon,
  MessageSquareReply,
  MessageSquareText,
  Pencil,
  SmilePlus,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { EMOJI_GROUPS } from "@/lib/docs/constants";
import { formatFileSize } from "@/lib/im/biz-meta";
import type { Card, ConversationDTO, FileContent, ImageContent, MessageDTO, UserLite } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/ui/use-action";
import { recallMessageAction } from "@/app/(app)/messages/actions";
import { editMsg, toggleReactionAction, type GroupMember } from "./store";
import { ConvAvatar } from "./conversation-list";
import { MessageContent } from "./content-render";
import { CardView } from "./card-view";
import { RefPreviewCard } from "./ref-preview";
import { convTime } from "./time";

const RECALL_MS = 2 * 60 * 1000;
const EDIT_MS = 24 * 60 * 60 * 1000;
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "👌", "👀"];

function scrollToMsg(id: string) {
  document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function ImageMessage({ img }: { img: ImageContent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-lg border border-line bg-white transition-opacity hover:opacity-95"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt={img.filename}
          loading="lazy"
          className="max-h-[280px] max-w-[320px] object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="lg"
          title={img.filename}
          footer={
            <a
              href={`${img.url}?download=1`}
              download={img.filename}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover"
            >
              <Download className="size-3.5" />
              下载原图（{formatFileSize(img.size)}）
            </a>
          }
        >
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-md bg-sidebar p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.filename} className="max-h-[65vh] max-w-full object-contain" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FileMessage({ file }: { file: FileContent }) {
  return (
    <a
      href={`${file.url}?download=1`}
      download={file.filename}
      className="flex w-[280px] max-w-[75vw] items-center gap-3 rounded-lg border border-line bg-white p-3 shadow-card transition-shadow hover:shadow-pop"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <FileIcon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">{file.filename}</span>
        <span className="mt-0.5 block text-xs text-ink-3">{formatFileSize(file.size)}</span>
      </span>
      <Download className="size-4 shrink-0 text-ink-3" />
    </a>
  );
}

function ReactionPicker({
  align,
  onSelect,
}: {
  align: "start" | "end";
  onSelect: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const pick = (emoji: string) => {
    onSelect(emoji);
    setOpen(false);
    setExpanded(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setExpanded(false);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="rounded p-1 text-ink-2 hover:bg-hover" title="表情回应" aria-label="表情回应">
          <SmilePlus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("p-1.5", expanded ? "w-[320px]" : "w-auto")}>
        <div className="flex items-center gap-0.5">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => pick(emoji)}
              className="flex size-7 items-center justify-center rounded text-base transition-transform hover:scale-110 hover:bg-hover"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-0.5 rounded px-1.5 py-1 text-[11px] text-ink-2 hover:bg-hover"
          >
            {expanded ? "收起" : "更多"}
          </button>
        </div>
        {expanded && (
          <div className="mt-1.5 max-h-[220px] overflow-y-auto border-t border-line pt-1.5">
            {EMOJI_GROUPS.map((g) => (
              <div key={g.label} className="mb-1.5">
                <div className="px-1 pb-0.5 text-[11px] font-medium text-ink-3">{g.label}</div>
                <div className="grid grid-cols-9 gap-0.5">
                  {g.items.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => pick(e)}
                      className="flex size-7 items-center justify-center rounded text-lg hover:bg-hover"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function InlineMessageEditor({
  initialContent,
  onSave,
  onCancel,
}: {
  initialContent: unknown;
  onSave: (doc: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [empty, setEmpty] = useState(false);
  const handlersRef = useRef<{ save: () => void; cancel: () => void }>({ save: () => {}, cancel: onCancel });

  const editor = useEditor({
    immediatelyRender: false,
    content: (initialContent as never) ?? "",
    extensions: [
      StarterKit.configure({
        undoRedo: {},
        hardBreak: {},
        bold: false,
        italic: false,
        strike: false,
        underline: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        heading: false,
        horizontalRule: false,
        link: false,
        gapcursor: false,
        trailingNode: false,
      }),
      Mention.configure({ HTMLAttributes: { class: "doc-mention" } }),
    ],
    editorProps: {
      attributes: {
        class: "min-w-[200px] max-w-[440px] rounded-md border border-accent bg-white px-2.5 py-1.5 text-[14px] leading-relaxed text-ink outline-none",
        spellcheck: "false",
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          handlersRef.current.cancel();
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !view.composing && event.keyCode !== 229) {
          event.preventDefault();
          handlersRef.current.save();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => setEmpty(ed.isEmpty),
  });

  useEffect(() => {
    editor?.commands.focus("end");
  }, [editor]);

  const submit = async () => {
    if (!editor || editor.isDestroyed || editor.isEmpty || saving) return;
    setSaving(true);
    try {
      await onSave(JSON.parse(JSON.stringify(editor.getJSON())));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    handlersRef.current = { save: () => void submit(), cancel: onCancel };
  });

  return (
    <div className="flex flex-col gap-1.5">
      <EditorContent editor={editor} />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[11px] text-ink-3">Esc 取消 · Enter 保存</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded px-2 py-0.5 text-xs text-ink-2 hover:bg-hover"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={empty || saving}
          className="rounded bg-accent px-2.5 py-0.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

type ReceiptData = {
  read: UserLite[];
  unread: UserLite[];
};

function GroupReceiptStatus({
  conv,
  msg,
  meId,
  members,
}: {
  conv: ConversationDTO;
  msg: MessageDTO;
  meId: string;
  members?: GroupMember[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReceiptData | null>(null);

  const others = (members ?? []).filter((m) => m.id !== meId);
  const totalOthers = others.length > 0 ? others.length : Math.max(0, conv.memberCount - 1);
  if (totalOthers <= 0) return null;

  const readCount = others.filter((m) => (m.lastReadSeq ?? 0) >= msg.seq).length;
  const label = readCount >= totalOthers ? "全部已读" : readCount > 0 ? `${readCount}人已读` : "未读";

  const openDialog = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/im/conversations/${conv.id}/receipts?seq=${msg.seq}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as ReceiptData;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-ink-3 hover:text-accent"
      >
        {readCount >= totalOthers ? <CheckCheck className="size-3 text-accent" /> : <Check className="size-3" />}
        <span>{label}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="消息已读详情" size="sm">
          {loading && !data ? (
            <div className="flex h-24 items-center justify-center">
              <span className="size-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
            </div>
          ) : data ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-2 text-xs font-medium text-ink-2">已读（{data.read.length}）</div>
                <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                  {data.read.length === 0 ? (
                    <div className="text-xs text-ink-3">暂无</div>
                  ) : (
                    data.read.map((u) => (
                      <div key={u.id} className="flex items-center gap-2 text-[13px] text-ink">
                        <Avatar name={u.name} color={u.avatarColor} size={22} />
                        <span className="truncate">{u.name}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="border-l border-line pl-3">
                <div className="mb-2 text-xs font-medium text-ink-2">未读（{data.unread.length}）</div>
                <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                  {data.unread.length === 0 ? (
                    <div className="text-xs text-ink-3">全部已读</div>
                  ) : (
                    data.unread.map((u) => (
                      <div key={u.id} className="flex items-center gap-2 text-[13px] text-ink-2">
                        <Avatar name={u.name} color={u.avatarColor} size={22} />
                        <span className="truncate">{u.name}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-ink-3">加载失败</div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MessageItem({
  msg,
  conv,
  me,
  grouped,
  onReply,
  inThread = false,
  members,
  onOpenThread,
  highlighted = false,
}: {
  msg: MessageDTO;
  conv: ConversationDTO;
  me: UserLite;
  /** 与上一条同发送者且间隔 <5min：不重复头像/姓名 */
  grouped: boolean;
  onReply?: (msg: MessageDTO) => void;
  inThread?: boolean;
  members?: GroupMember[];
  onOpenThread?: (msg: MessageDTO) => void;
  highlighted?: boolean;
}) {
  const { run } = useAction();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  if (msg.type === "SYSTEM") {
    return (
      <div className="px-4 py-1 text-center text-xs text-ink-3" id={`msg-${msg.id}`} data-seq={msg.seq}>
        {msg.text}
      </div>
    );
  }
  if (msg.recalled) {
    return (
      <div className="px-4 py-1 text-center text-xs text-ink-3" id={`msg-${msg.id}`} data-seq={msg.seq}>
        {msg.sender?.id === me.id ? "你" : (msg.sender?.name ?? "对方")} 撤回了一条消息
      </div>
    );
  }

  const mine = msg.sender?.id === me.id;
  const isCard = msg.type === "CARD";
  const isImage = msg.type === "IMAGE";
  const isFile = msg.type === "FILE";
  const frameless = !editing && (isCard || isImage || isFile);
  const card = isCard ? (msg.content as Card | null) : null;
  const img = isImage ? (msg.content as ImageContent | null) : null;
  const file = isFile ? (msg.content as FileContent | null) : null;
  const canRecall = mine && (msg.type === "TEXT" || isImage || isFile);
  const canEdit = mine && msg.type === "TEXT";
  const canThread = !inThread && conv.type !== "BOT" && !!onOpenThread;

  const copy = () => {
    void navigator.clipboard.writeText(msg.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const bubble = (
    <div
      className={cn(
        "group/bubble relative w-fit max-w-[min(560px,75%)] rounded-xl px-3 py-2 text-[14px] leading-relaxed",
        inThread && "max-w-[270px]",
        mine ? "rounded-tr-sm bg-accent-soft text-ink" : "rounded-tl-sm border border-line bg-white text-ink",
        frameless && "border-none bg-transparent p-0",
      )}
    >
      {/* 回复引用 */}
      {msg.replyTo && !editing && (
        <button
          onClick={() => scrollToMsg(msg.replyTo!.id)}
          className={cn(
            "mb-1 block w-full border-l-2 pl-2 text-left text-xs",
            mine ? "border-accent/50 text-ink-2" : "border-line-strong text-ink-3",
            frameless && "rounded-md bg-white p-2",
          )}
        >
          <span className="font-medium">{msg.replyTo.senderName ?? "消息"}：</span>
          {msg.replyTo.recalled ? "消息已撤回" : msg.replyTo.text.slice(0, 80)}
        </button>
      )}
      {editing ? (
        <InlineMessageEditor
          initialContent={msg.content}
          onCancel={() => setEditing(false)}
          onSave={async (doc) => {
            const ok = await editMsg(conv.id, msg.id, doc);
            if (ok) setEditing(false);
          }}
        />
      ) : isCard ? (
        card ? (
          <CardView messageId={msg.id} card={card} />
        ) : (
          <div className="rounded-md border border-line bg-white p-3 text-xs text-ink-3">卡片内容不可用</div>
        )
      ) : isImage ? (
        img ? (
          <ImageMessage img={img} />
        ) : (
          <div className="rounded-md border border-line bg-white p-3 text-xs text-ink-3">图片不可用</div>
        )
      ) : isFile ? (
        file ? (
          <FileMessage file={file} />
        ) : (
          <div className="rounded-md border border-line bg-white p-3 text-xs text-ink-3">文件不可用</div>
        )
      ) : (
        <MessageContent content={msg.content} meId={me.id} />
      )}
      {!editing && msg.editedAt && (
        <div className="mt-0.5 text-right text-[10px] leading-none text-ink-3">已编辑</div>
      )}
      {!editing && msg.links?.map((r) => <RefPreviewCard key={`${r.type}:${r.id}`} r={r} mine={mine} />)}

      {/* 悬浮工具条 */}
      {!editing && (
        <div
          className={cn(
            "absolute -top-3.5 z-10 hidden items-center gap-0.5 rounded-md border border-line bg-white p-0.5 shadow-card group-hover/bubble:flex",
            mine ? "right-0" : "left-0",
          )}
        >
          <ReactionPicker
            align={mine ? "end" : "start"}
            onSelect={(emoji) => void toggleReactionAction(conv.id, msg.id, emoji)}
          />
          {onReply && !inThread && (
            <button onClick={() => onReply(msg)} className="rounded p-1 text-ink-2 hover:bg-hover" title="引用回复">
              <MessageSquareReply className="size-3.5" />
            </button>
          )}
          {canThread && (
            <button onClick={() => onOpenThread(msg)} className="rounded p-1 text-ink-2 hover:bg-hover" title="话题回复">
              <MessageSquareText className="size-3.5" />
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => {
                if (Date.now() - new Date(msg.createdAt).getTime() >= EDIT_MS) {
                  toast.error("发送超过 24 小时，无法编辑");
                  return;
                }
                setEditing(true);
              }}
              className="rounded p-1 text-ink-2 hover:bg-hover"
              title="编辑"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {!isImage && !isFile && (
            <button onClick={copy} className="rounded p-1 text-ink-2 hover:bg-hover" title="复制">
              {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
            </button>
          )}
          {canRecall && (
            <button
              onClick={() => {
                if (Date.now() - new Date(msg.createdAt).getTime() >= RECALL_MS) {
                  toast.error("发送超过 2 分钟，无法撤回");
                  return;
                }
                void run(() => recallMessageAction(msg.id), { refresh: false });
              }}
              className="rounded p-1 text-ink-2 hover:bg-hover"
              title="撤回"
            >
              <Undo2 className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  const isBotMsg = !msg.sender && conv.type === "BOT";
  const showDirectReceipt = mine && !inThread && conv.type === "DIRECT";
  const showGroupReceipt = mine && !inThread && conv.type === "GROUP";
  const directRead = (conv.peerLastReadSeq ?? 0) >= msg.seq;

  return (
    <div
      id={`msg-${msg.id}`}
      data-seq={msg.seq}
      className={cn(
        "flex px-4 transition-colors duration-500",
        inThread && "px-3",
        mine ? "justify-end" : "justify-start",
        grouped ? "pt-0.5" : "pt-3",
        highlighted && "bg-accent-soft/60 py-1.5",
      )}
    >
      <div className={cn("flex max-w-full gap-2", mine && "flex-row-reverse")}>
        {/* 头像占位保持对齐 */}
        <div className="w-8 shrink-0">
          {!grouped &&
            (isBotMsg ? (
              <ConvAvatar conv={conv} size={32} />
            ) : (
              <Avatar name={msg.sender?.name ?? conv.name} color={msg.sender?.avatarColor ?? conv.avatarColor} size={32} />
            ))}
        </div>
        <div className={cn("min-w-0", mine && "flex flex-col items-end")}>
          {!grouped && !mine && (conv.type === "GROUP" || inThread) && (
            <div className="mb-0.5 px-0.5 text-xs text-ink-3">{msg.sender?.name ?? "系统"}</div>
          )}
          {bubble}

          {/* 表情回应列表 */}
          {msg.reactions.length > 0 && (
            <div className={cn("mt-1 flex flex-wrap gap-1", mine && "justify-end")}>
              {msg.reactions.map((r) => {
                const reactedByMe = r.users.some((u) => u.id === me.id);
                return (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => void toggleReactionAction(conv.id, msg.id, r.emoji)}
                    title={r.users.map((u) => u.name).join("、")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                      reactedByMe
                        ? "border-accent/50 bg-accent-soft text-accent"
                        : "border-line bg-white text-ink-2 hover:bg-hover",
                    )}
                  >
                    <span>{r.emoji}</span>
                    <span className="font-medium">{r.users.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 话题摘要条 */}
          {!inThread && msg.threadCount > 0 && onOpenThread && (
            <button
              type="button"
              onClick={() => onOpenThread(msg)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-xs text-accent transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
            >
              {msg.threadParticipants && msg.threadParticipants.length > 0 && (
                <span className="flex -space-x-1">
                  {msg.threadParticipants.slice(0, 3).map((u) => (
                    <Avatar key={u.id} name={u.name} color={u.avatarColor} size={16} />
                  ))}
                </span>
              )}
              <span className="font-medium">{msg.threadCount} 条回复</span>
              {msg.threadLastAt && <span className="text-[11px] text-ink-3">{convTime(msg.threadLastAt)}</span>}
            </button>
          )}

          {/* 已读回执 */}
          {showDirectReceipt && (
            <div className="mt-0.5 flex items-center gap-0.5 text-[11px] text-ink-3">
              {directRead ? (
                <>
                  <CheckCheck className="size-3 text-accent" />
                  <span>已读</span>
                </>
              ) : (
                <>
                  <Check className="size-3" />
                  <span>未读</span>
                </>
              )}
            </div>
          )}
          {showGroupReceipt && <GroupReceiptStatus conv={conv} msg={msg} meId={me.id} members={members} />}
        </div>
      </div>
    </div>
  );
}

/** 发送中的乐观气泡 / 失败气泡 */
export function PendingItem({
  text,
  failed,
  onRetry,
  onDiscard,
}: {
  text: string;
  failed: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex justify-end px-4 pt-0.5">
      <div className="flex items-center gap-1.5">
        {failed ? (
          <>
            <button onClick={onRetry} className="text-xs text-danger hover:underline">
              发送失败，点击重试
            </button>
            <button onClick={onDiscard} className="text-xs text-ink-3 hover:underline">
              删除
            </button>
          </>
        ) : (
          <span className="size-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        )}
        <div className="w-fit max-w-[min(560px,75%)] rounded-xl rounded-tr-sm bg-accent-soft px-3 py-2 text-[14px] leading-relaxed text-ink opacity-70">
          <div className="whitespace-pre-wrap break-words">{text}</div>
        </div>
      </div>
    </div>
  );
}
