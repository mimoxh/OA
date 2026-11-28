import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideProps,
} from "lucide-react";
import { resolvePreview, type PreviewKind } from "@/lib/file-preview/kinds";

const ICONS: Record<PreviewKind, typeof FileIcon> = {
  pdf: FileText,
  docx: FileText,
  sheet: FileSpreadsheet,
  pptx: Presentation,
  markdown: FileText,
  json: FileCode,
  text: FileText,
  image: FileImage,
  svg: FileImage,
  video: FileVideo,
  audio: FileAudio,
  zip: FileArchive,
  unsupported: FileIcon,
};

/** 按文件类型显示的图标 */
export function FileKindIcon({ fileName, mimeType, ...props }: { fileName: string; mimeType?: string | null } & LucideProps) {
  const info = resolvePreview({ fileName, mimeType });
  const Icon = info.kind === "text" && info.label === "代码" ? FileCode : info.ext === "rar" || info.ext === "7z" ? FileArchive : ICONS[info.kind];
  return <Icon {...props} />;
}
