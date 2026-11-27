"use client";

import { useState } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Download, Eye } from "lucide-react";
import { FileAttachment } from "@/lib/docs/schema";
import { FilePreviewDialog, filePreviewMode } from "@/components/file-preview/file-preview-dialog";
import { FileKindIcon } from "@/components/file-preview/file-kind-icon";

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const actionClass =
  "rounded px-1.5 py-0.5 text-xs text-ink-2 hover:bg-hover hover:text-ink pointer-coarse:px-2.5 pointer-coarse:py-2";

function FileAttachmentCard({ node }: NodeViewProps) {
  const { id, fileName, mediaType, size } = node.attrs as { id: string; fileName: string; mediaType: string; size: number };
  const name = fileName || "附件";
  const url = `/api/docs/attachments/${id}`;
  const downloadHref = `${url}?download=1`;
  // 电脑和手机都在页内预览（手机全屏、电脑居中弹窗），不再依赖浏览器新标签页
  const mode = filePreviewMode({ fileName: name, mimeType: mediaType, size: Number(size) || undefined });
  const [preview, setPreview] = useState(false);
  return (
    <NodeViewWrapper className="doc-attachment" data-type="file-attachment">
      <span className="doc-attachment-icon">
        <FileKindIcon fileName={name} mimeType={mediaType} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
        <span className="block text-[11px] text-ink-3">{formatSize(Number(size) || 0)}</span>
      </span>
      {mode !== "download" && (
        <button
          type="button"
          className={actionClass}
          data-attachment-preview={mode}
          onClick={(e) => {
            e.stopPropagation();
            setPreview(true);
          }}
        >
          <Eye className="mr-0.5 inline size-3.5" />
          预览
        </button>
      )}
      <a className={actionClass} href={downloadHref} onClick={(e) => e.stopPropagation()}>
        <Download className="mr-0.5 inline size-3.5" />
        下载
      </a>
      {preview && (
        <FilePreviewDialog
          open
          onOpenChange={setPreview}
          file={{ url, fileName: name, mimeType: mediaType, size: Number(size) || undefined, downloadHref }}
        />
      )}
    </NodeViewWrapper>
  );
}

/** fileAttachment 节点的 React 渲染版（仅客户端编辑器使用；schema 本体在 lib/docs/schema） */
export const FileAttachmentView = FileAttachment.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentCard);
  },
});
