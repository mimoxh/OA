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
import { BubbleToolbar, TableToolbar } from "./toolbars";

export type EditorCallbacks = {
  onCommentClick: (id: string) => void;
  onAddComment: (sel: { from: number; to: number; quote: string }) => void;
  onLinkPage: (range: Range) => void;
  onImage: (range: Range) => void;
  onMention: (userId: string) => void;
};

/** 处理编辑器内链接点击：站内文档链接直接跳转，外链需 Ctrl/⌘ + 点击（只读时直接打开） */
export function useLinkClick() {
  const router = useRouter();
  return (event: MouseEvent, editable: boolean) => {
    const a = (event.target as HTMLElement).closest("a[href]");
    if (!a) return false;
    const href = a.getAttribute("href") ?? "";
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
  provider,
  ydoc,
  user,
  editable,
  members,
  callbacks,
  onReady,
}: {
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
        }),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === "heading" ? `标题 ${node.attrs.level}` : "输入 / 唤出命令，@ 提及成员"),
        }),
        Collaboration.configure({ document: ydoc, field: COLLAB_FIELD }),
        CollaborationCaret.configure({ provider, user: { id: user.id, name: user.name, color: user.color } }),
        SlashCommand.configure({
          items: () => buildSlashItems({ onImage: (r) => callbacks.onImage(r), onLinkPage: (r) => callbacks.onLinkPage(r) }),
        }),
      ],
      editorProps: {
        attributes: { class: "doc-prose", spellcheck: "false" },
        handleClick: (view, _pos, event) => {
          const c = (event.target as HTMLElement).closest("[data-comment-id]");
          if (c) cb.current.onCommentClick(c.getAttribute("data-comment-id")!);
          return linkRef.current(event, view.editable);
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
