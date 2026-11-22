"use client";

import { useState } from "react";
import { Check, Copy, Download, File as FileIcon, MessageSquareReply, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/im/biz-meta";
import type { Card, ConversationDTO, FileContent, ImageContent, MessageDTO, UserLite } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/ui/use-action";
import { recallMessageAction } from "@/app/(app)/messages/actions";
import { ConvAvatar } from "./conversation-list";
import { MessageContent } from "./content-render";
import { CardView } from "./card-view";
import { RefPreviewCard } from "./ref-preview";

const RECALL_MS = 2 * 60 * 1000;

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

export function MessageItem({
  msg,
  conv,
  me,
  grouped,
  onReply,
}: {
  msg: MessageDTO;
  conv: ConversationDTO;
  me: UserLite;
  /** 与上一条同发送者且间隔 <5min：不重复头像/姓名 */
  grouped: boolean;
  onReply: (msg: MessageDTO) => void;
}) {
  const { run } = useAction();
  const [copied, setCopied] = useState(false);

  if (msg.type === "SYSTEM") {
    return (
      <div className="px-4 py-1 text-center text-xs text-ink-3" id={`msg-${msg.id}`}>
        {msg.text}
      </div>
    );
  }
  if (msg.recalled) {
    return (
      <div className="px-4 py-1 text-center text-xs text-ink-3" id={`msg-${msg.id}`}>
        {msg.sender?.id === me.id ? "你" : (msg.sender?.name ?? "对方")} 撤回了一条消息
      </div>
    );
  }

  const mine = msg.sender?.id === me.id;
  const isCard = msg.type === "CARD";
  const isImage = msg.type === "IMAGE";
  const isFile = msg.type === "FILE";
  const frameless = isCard || isImage || isFile;
  const card = isCard ? (msg.content as Card | null) : null;
  const img = isImage ? (msg.content as ImageContent | null) : null;
  const file = isFile ? (msg.content as FileContent | null) : null;
  const canRecall = mine && (msg.type === "TEXT" || isImage || isFile);

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
        mine ? "rounded-tr-sm bg-accent-soft text-ink" : "rounded-tl-sm border border-line bg-white text-ink",
        frameless && "border-none bg-transparent p-0",
      )}
    >
      {/* 回复引用 */}
      {msg.replyTo && (
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
      {isCard ? (
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
      {msg.links?.map((r) => <RefPreviewCard key={`${r.type}:${r.id}`} r={r} mine={mine} />)}

      {/* 悬浮工具条 */}
      <div
        className={cn(
          "absolute -top-3 hidden items-center gap-0.5 rounded-md border border-line bg-white p-0.5 shadow-card group-hover/bubble:flex",
          mine ? "right-0" : "left-0",
        )}
      >
        <button onClick={() => onReply(msg)} className="rounded p-1 text-ink-2 hover:bg-hover" title="回复">
          <MessageSquareReply className="size-3.5" />
        </button>
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
    </div>
  );

  const isBotMsg = !msg.sender && conv.type === "BOT";

  return (
    <div id={`msg-${msg.id}`} className={cn("flex px-4", mine ? "justify-end" : "justify-start", grouped ? "pt-0.5" : "pt-3")}>
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
          {!grouped && !mine && conv.type === "GROUP" && (
            <div className="mb-0.5 px-0.5 text-xs text-ink-3">{msg.sender?.name ?? "系统"}</div>
          )}
          {bubble}
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
