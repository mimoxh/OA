"use client";

import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Download, Eye, FileArchive, FileText, File as FileIcon } from "lucide-react";
import { FileAttachment } from "@/lib/docs/schema";

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileAttachmentCard({ node }: NodeViewProps) {
  const { id, fileName, mediaType, size } = node.attrs as { id: string; fileName: string; mediaType: string; size: number };
  const base = (mediaType ?? "").split(";")[0];
  const Icon = base === "application/pdf" ? FileText : base === "application/zip" ? FileArchive : FileIcon;
  const url = `/api/docs/attachments/${id}`;
  return (
    <NodeViewWrapper className="doc-attachment" data-type="file-attachment">
      <span className="doc-attachment-icon">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{fileName || "附件"}</span>
        <span className="block text-[11px] text-ink-3">{formatSize(Number(size) || 0)}</span>
      </span>
      {base === "application/pdf" && (
        <a
          className="rounded px-1.5 py-0.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <Eye className="mr-0.5 inline size-3.5" />
          预览
        </a>
      )}
      <a
        className="rounded px-1.5 py-0.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
        href={`${url}?download=1`}
        onClick={(e) => e.stopPropagation()}
      >
        <Download className="mr-0.5 inline size-3.5" />
        下载
      </a>
    </NodeViewWrapper>
  );
}

/** fileAttachment 节点的 React 渲染版（仅客户端编辑器使用；schema 本体在 lib/docs/schema） */
export const FileAttachmentView = FileAttachment.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentCard);
  },
});
