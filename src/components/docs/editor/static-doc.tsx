"use client";

import "./editor.css";
import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { createSchemaExtensions } from "@/lib/docs/schema";
import { useLinkClick } from "./collab-editor";

/** 只读渲染 Tiptap JSON（离线预览、历史版本预览） */
export function StaticDoc({ content, onCommentClick }: { content: JSONContent; onCommentClick?: (id: string) => void }) {
  const linkClick = useLinkClick();
  const ref = useRef({ linkClick, onCommentClick });
  useEffect(() => {
    ref.current = { linkClick, onCommentClick };
  });
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: false,
      extensions: createSchemaExtensions(),
      content,
      editorProps: {
        attributes: { class: "doc-prose" },
        handleClick: (_view, _pos, event) => {
          const c = (event.target as HTMLElement).closest("[data-comment-id]");
          if (c) ref.current.onCommentClick?.(c.getAttribute("data-comment-id")!);
          return ref.current.linkClick(event, false);
        },
      },
    },
    [content],
  );
  return <EditorContent editor={editor} />;
}
