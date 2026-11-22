"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention, { type MentionOptions } from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { CornerUpLeft, Image as ImageIcon, Paperclip, SendHorizontal, Smile, X } from "lucide-react";
import { toast } from "sonner";
import type { ConversationDTO, MessageDTO, UserLite } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import { mentionSuggestion, type MentionItem } from "@/components/docs/editor/suggestion";
import { EmojiPicker } from "@/components/docs/emoji-picker";
import { sendRealtime } from "@/components/realtime/provider";
import { getDraft, sendAttachment, sendText, setDraft, useGroupMembers } from "./store";
import "@/components/docs/editor/editor.css";

const MAX_CHARS = 5000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * 每个会话一条最新闭包：编辑器实例在 convId 变化前不重建，PM 插件（suggestion/快捷键）
 * 通过此表拿到最新的成员列表与发送函数，避免在渲染期读写 ref。
 */
const liveComposers = new Map<string, { items: () => MentionItem[]; send: () => void }>();

type DocNode = { type?: string; text?: string; attrs?: { label?: string }; content?: DocNode[] };

/** 与服务端一致的纯文本计数（mention 记为 @label，段落记换行） */
function plainText(doc: DocNode): string {
  const paras = doc.content ?? [];
  return paras
    .map((p) =>
      (p.content ?? [])
        .map((n) => (n.type === "text" ? (n.text ?? "") : n.type === "mention" ? `@${n.attrs?.label ?? ""}` : "\n"))
        .join(""),
    )
    .join("\n");
}

const SendKey = Extension.create<{ onSend: () => void }>({
  name: "imSend",
  addOptions() {
    return { onSend: () => {} };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("imSend"),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing || view.composing || event.keyCode === 229) {
              return false;
            }
            event.preventDefault();
            this.options.onSend();
            return true;
          },
        },
      }),
    ];
  },
});

export function Composer({
  conv,
  me,
  replyTo,
  onClearReply,
}: {
  conv: ConversationDTO;
  me: UserLite;
  replyTo: MessageDTO | null;
  onClearReply: () => void;
}) {
  const convId = conv.id;
  const members = useGroupMembers(convId);
  const [empty, setEmpty] = useState(true);
  const [dragging, setDragging] = useState(false);
  const lastTyping = useRef(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (conv.type === "GROUP") {
      return [
        { id: "all", label: "所有人", color: "#2383e2", title: "通知群内所有人" },
        ...(members ?? [])
          .filter((m) => m.id !== me.id)
          .map((m) => ({ id: m.id, label: m.name, color: m.avatarColor, title: null })),
      ];
    }
    if (conv.type === "DIRECT" && conv.peerId) {
      return [{ id: conv.peerId, label: conv.name, color: conv.avatarColor, title: null }];
    }
    return [];
  }, [conv.type, conv.peerId, conv.name, conv.avatarColor, members, me.id]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      content: (getDraft(convId) as never) ?? "",
      extensions: [
        StarterKit.configure({
          undoRedo: {},
          hardBreak: {},
          dropcursor: {},
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
        Placeholder.configure({ placeholder: conv.type === "GROUP" ? "输入消息，@ 提及成员，可粘贴或拖入图片/文件" : "输入消息，可粘贴或拖入图片/文件" }),
        Mention.configure({
          HTMLAttributes: { class: "doc-mention" },
          suggestion: mentionSuggestion(() => liveComposers.get(convId)?.items() ?? [], () => {}) as MentionOptions["suggestion"],
        }),
        SendKey.configure({ onSend: () => liveComposers.get(convId)?.send() }),
      ],
      editorProps: {
        attributes: {
          class: "im-composer px-3 py-2 text-sm leading-relaxed text-ink outline-none",
          spellcheck: "false",
        },
      },
      onUpdate: ({ editor: ed }) => {
        setEmpty(ed.isEmpty);
        const now = Date.now();
        if (now - lastTyping.current > 3000) {
          lastTyping.current = now;
          sendRealtime({ type: "typing", conversationId: convId });
        }
      },
    },
    [convId],
  );

  // 草稿：切换会话 / 卸载时保存
  useEffect(() => {
    const ed = editor;
    const cid = convId;
    return () => {
      if (ed && !ed.isDestroyed) setDraft(cid, ed.isEmpty ? null : ed.getJSON());
    };
  }, [editor, convId]);

  const sendFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const replyId = replyTo?.id ?? null;
    if (replyId) onClearReply();
    for (const file of list.slice(0, 5)) {
      if (file.size <= 0) {
        toast.error(`「${file.name}」为空文件`);
        continue;
      }
      const isImg = file.type.startsWith("image/") && file.type !== "image/svg+xml";
      if (isImg && file.size > MAX_IMAGE_BYTES) {
        toast.error(`图片「${file.name}」超过 10 MB 限制`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`文件「${file.name}」超过 25 MB 限制`);
        continue;
      }
      void sendAttachment(convId, file, replyId);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    sendFiles(files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      if (!dragging) setDragging(true);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    setDragging(false);
    sendFiles(e.dataTransfer.files);
  };

  const send = () => {
    const ed = editor;
    if (!ed || ed.isDestroyed || ed.isEmpty) return;
    const json = ed.getJSON();
    const text = plainText(json);
    if (text.length > MAX_CHARS) {
      toast.error(`消息不能超过 ${MAX_CHARS} 字`);
      return;
    }
    void sendText(convId, JSON.parse(JSON.stringify(json)), replyTo?.id ?? null);
    onClearReply();
    ed.commands.clearContent(true);
    setDraft(convId, null);
  };

  // 每次渲染后刷新最新闭包，供创建期的 PM 插件回调使用
  useEffect(() => {
    liveComposers.set(convId, { items: () => mentionItems, send });
    return () => {
      liveComposers.delete(convId);
    };
  });

  return (
    <div
      className="shrink-0 border-t border-line bg-white px-3 pb-2.5 pt-2"
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) sendFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) sendFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {replyTo && (
        <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-sidebar px-2.5 py-1.5 text-xs text-ink-2">
          <CornerUpLeft className="size-3.5 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate">
            回复 <span className="font-medium">{replyTo.sender?.name ?? "消息"}</span>：
            {replyTo.recalled ? "消息已撤回" : replyTo.text.slice(0, 60)}
          </span>
          <button onClick={onClearReply} className="rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink" aria-label="取消回复">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div
        className={cn(
          "rounded-lg border transition-colors focus-within:border-accent",
          dragging ? "border-accent bg-accent-soft/40" : "border-line-strong",
        )}
      >
        <div className="max-h-36 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <div className="flex items-center gap-0.5">
            <EmojiPicker onSelect={(e) => editor?.chain().focus().insertContent(e).run()}>
              <button type="button" className="rounded-md p-1.5 text-ink-2 hover:bg-hover" title="表情" aria-label="表情">
                <Smile className="size-4" />
              </button>
            </EmojiPicker>
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="rounded-md p-1.5 text-ink-2 hover:bg-hover"
              title="发送图片"
              aria-label="发送图片"
            >
              <ImageIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md p-1.5 text-ink-2 hover:bg-hover"
              title="发送文件"
              aria-label="发送文件"
            >
              <Paperclip className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => send()}
            disabled={empty}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium",
              empty ? "text-ink-3" : "bg-accent text-white hover:bg-accent-hover",
            )}
          >
            <SendHorizontal className="size-3.5" />
            发送
          </button>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-ink-3">Enter 发送，Shift+Enter 换行；支持拖拽或粘贴发送图片/文件</div>
    </div>
  );
}
