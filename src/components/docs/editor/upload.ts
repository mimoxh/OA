"use client";

import { toast } from "sonner";
import type { Editor } from "@tiptap/core";
import type { JSONNode } from "@/lib/docs/content";

export type UploadedAttachment = { id: string; url: string; fileName: string; mediaType: string; size: number };

const MAX_MB = 10;

export async function uploadAttachment(file: File, documentId: string): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append("documentId", documentId);
  form.append("file", file);
  const res = await fetch("/api/docs/attachments", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "上传失败");
  return data as UploadedAttachment;
}

export function nodeForUpload(att: UploadedAttachment): JSONNode {
  return att.mediaType.startsWith("image/")
    ? { type: "image", attrs: { src: att.url, alt: att.fileName } }
    : { type: "fileAttachment", attrs: { id: att.id, fileName: att.fileName, mediaType: att.mediaType, size: att.size } };
}

/** 逐个上传文件并插入到编辑器 pos 处；编辑器销毁或不可编辑时放弃插入 */
export async function uploadFilesIntoEditor(editor: Editor | null, files: Iterable<File>, documentId: string, pos?: number | null) {
  if (!editor) return;
  let at = pos ?? null;
  for (const file of files) {
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`「${file.name}」超过 10MB 大小限制`);
      continue;
    }
    const t = toast.loading(`正在上传「${file.name}」…`);
    try {
      const att = await uploadAttachment(file, documentId);
      if (editor.isDestroyed || !editor.isEditable) {
        toast.dismiss(t);
        return;
      }
      const insertAt = Math.min(at ?? editor.state.selection.from, editor.state.doc.content.size);
      editor.chain().focus().insertContentAt(insertAt, nodeForUpload(att)).run();
      const inserted = editor.state.doc.nodeAt(insertAt);
      if (at !== null) at = insertAt + (inserted?.nodeSize ?? 1);
      toast.success(`已上传「${att.fileName}」`, { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败", { id: t });
    }
  }
}
