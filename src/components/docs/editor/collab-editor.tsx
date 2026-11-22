"use client";

import "./editor.css";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Range } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import { COLLAB_FIELD, createSchemaExtensions } from "@/lib/docs/schema";
import { SlashCommand, buildSlashItems, mentionSuggestion, type MentionItem } from "./suggestion";
import { WikiLinkSuggestion } from "./wikilink-suggestion";
import { BubbleToolbar, TableToolbar } from "./toolbars";
import { FileAttachmentView } from "./file-attachment";

export type EditorCallbacks = {
  onCommentClick: (id: string) => void;
  onAddComment: (sel: { from: number; to: number; quote: string }) => void;
  onLinkPage: (range: Range) => void;
  onImage: (range: Range) => void;
  onFile: (range: Range) => void;
  onFiles: (files: File[], pos: number | null) => void;
  onMention: (userId: string) => void;
  onQuickCreatePage: (title: string) => Promise<{ id: string; title: string } | null>;
};

/** 处理编辑器内链接点击：站内文档链接直接跳转，外链需 Ctrl/⌘ + 点击（只读时直接打开） */
export function useLinkClick() {
  const router = useRouter();
  return (event: MouseEvent, editable: boolean) => {
    const a = (event.target as HTMLElement).closest("a[href]");
    if (!a) return false;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("/api/")) {
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    if (href.startsWith("/")) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) window.open(href, "_blank");
      else router.push(href);
      return true;
    }
    if (event.ctrlKey || event.metaKey || !editable) {
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  };
}

export function CollabEditor({
  docId,
  provider,
  ydoc,
  user,
  editable,
  members,
  callbacks,
  onReady,
}: {
  docId: string;
  provider: HocuspocusProvider;
  ydoc: Y.Doc;
  user: { id: string; name: string; color: string };
  editable: boolean;
  members: MentionItem[];
  callbacks: EditorCallbacks;
  onReady: (editor: Editor | null) => void;
}) {
  const cb = useRef(callbacks);
  const linkClick = useLinkClick();
  const linkRef = useRef(linkClick);
  useEffect(() => {
    cb.current = callbacks;
    linkRef.current = linkClick;
  });

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        ...createSchemaExtensions({
          mention: { suggestion: mentionSuggestion(() => members, (id) => callbacks.onMention(id)) },
        }).map((e) => (e.name === "fileAttachment" ? FileAttachmentView : e)),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === "heading" ? `标题 ${node.attrs.level}` : "输入 / 唤出命令，[[ 链接页面，@ 提及成员"),
        }),
        Collaboration.configure({ document: ydoc, field: COLLAB_FIELD }),
        CollaborationCaret.configure({ provider, user: { id: user.id, name: user.name, color: user.color } }),
        SlashCommand.configure({
          items: () =>
            buildSlashItems({
              onImage: (r) => callbacks.onImage(r),
              onFile: (r) => callbacks.onFile(r),
              onLinkPage: (r) => callbacks.onLinkPage(r),
            }),
        }),
        WikiLinkSuggestion.configure({
          docId,
          onQuickCreate: (title) => callbacks.onQuickCreatePage(title),
        }),
      ],
      editorProps: {
        attributes: { class: "doc-prose", spellcheck: "false" },
        handleClick: (view, _pos, event) => {
          const c = (event.target as HTMLElement).closest("[data-comment-id]");
          if (c) cb.current.onCommentClick(c.getAttribute("data-comment-id")!);
          return linkRef.current(event, view.editable);
        },
        handlePaste: (view, event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (!files.length || !view.editable) return false;
          event.preventDefault();
          cb.current.onFiles(files, null);
          return true;
        },
        handleDrop: (view, event) => {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length || !view.editable) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
          cb.current.onFiles(files, pos);
          return true;
        },
      },
    },
    [provider, ydoc],
  );

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor, onReady]);

  if (!editor) return null;
  return (
    <>
      <EditorContent editor={editor} />
      <BubbleToolbar editor={editor} onComment={(sel) => cb.current.onAddComment(sel)} />
      {editable && <TableToolbar editor={editor} />}
    </>
  );
}
