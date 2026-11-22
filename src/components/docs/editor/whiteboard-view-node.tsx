"use client";

import Link from "next/link";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ExternalLink, Palette, X } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { WhiteboardViewNode } from "@/lib/docs/schema";
import { isWhiteboardDocumentId } from "@/lib/docs/whiteboard/content";
import { WhiteboardWorkspace } from "../whiteboard/whiteboard-workspace";

function WhiteboardViewBlock({ node, editor, deleteNode }: NodeViewProps) {
  const boardId: unknown = node.attrs.boardId;
  if (!isWhiteboardDocumentId(boardId)) {
    return <NodeViewWrapper className="my-4 rounded-md border border-line p-4 text-sm text-ink-3">
      白板引用无效
    </NodeViewWrapper>;
  }
  return (
    <NodeViewWrapper className="not-prose my-4 rounded-xl border border-line bg-white p-3" contentEditable={false} data-type="whiteboard-view">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5 font-medium"><Palette className="size-4 text-accent" />白板</span>
        <div className="flex items-center gap-2">
          <Link href={`/docs/${boardId}`} prefetch={false} className="flex items-center gap-1 hover:text-accent">
            打开白板 <ExternalLink className="size-3.5" />
          </Link>
          {editor.isEditable && (
            <IconButton title="移除嵌入白板" aria-label="移除嵌入白板" onClick={deleteNode}><X className="size-4" /></IconButton>
          )}
        </div>
      </div>
      <WhiteboardWorkspace boardId={boardId} compact readOnly={!editor.isEditable} />
    </NodeViewWrapper>
  );
}

export const WhiteboardViewExtension = WhiteboardViewNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(WhiteboardViewBlock, { stopEvent: () => true });
  },
});
