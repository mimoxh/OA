/**
 * 文档附件允许上传的类型（纯函数，服务端上传接口与测试共用）。
 */
import { fileExtension, MEDIA_MIME_BY_EXT, resolvePreview } from "@/lib/file-preview/kinds";

const TEXT_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
};
const OOXML_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const head = (b: Uint8Array, bytes: number[], offset = 0) => bytes.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

const CFB_EXT: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  // 加了密码的 docx / xlsx / pptx 外层是 CFB 容器
  ...OOXML_EXT,
};

function textCharset(bytes: Uint8Array): "utf-8" | "gb18030" | null {
  if (bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {}
  // Windows 上 Excel / 记事本导出的中文 CSV、TXT 常是 GBK
  try {
    new TextDecoder("gb18030", { fatal: true }).decode(bytes);
    return "gb18030";
  } catch {
    return null;
  }
}

function sniffMedia(bytes: Uint8Array, ext: string): string | null {
  const mime = MEDIA_MIME_BY_EXT[ext];
  if (!mime) return null;
  const ok =
    (ascii(bytes, 4, 4) === "ftyp" && ["mp4", "m4v", "mov", "m4a"].includes(ext)) ||
    (ext === "mp3" && (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) ||
    (ext === "aac" && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) ||
    (ext === "wav" && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") ||
    (["ogg", "oga", "opus", "ogv"].includes(ext) && ascii(bytes, 0, 4) === "OggS") ||
    (ext === "webm" && head(bytes, [0x1a, 0x45, 0xdf, 0xa3])) ||
    (ext === "flac" && ascii(bytes, 0, 4) === "fLaC");
  return ok ? mime : null;
}

/**
 * 按字节签名识别附件类型；识别不了的返回 null（拒绝上传）。
 * 二进制格式必须签名与扩展名一致；文本类只接受 UTF-8 / GBK 纯文本。
 * SVG 可以上传，但下载接口不会内联返回（见附件下载路由），预览时只当作 <img> 显示。
 */
export function sniffMediaType(bytes: Uint8Array, fileName: string): string | null {
  const ext = fileExtension(fileName);
  if (head(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (head(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (head(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ext === "bmp" && ascii(bytes, 0, 2) === "BM") return "image/bmp";
  if (bytes.length > 4 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (head(bytes, [0x50, 0x4b, 0x03, 0x04]) || head(bytes, [0x50, 0x4b, 0x05, 0x06])) return OOXML_EXT[ext] ?? "application/zip";
  if (head(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return CFB_EXT[ext] ?? null;
  const media = sniffMedia(bytes, ext);
  if (media) return media;
  const kind = resolvePreview({ fileName }).kind;
  if (ext === "svg") {
    if (textCharset(bytes) !== "utf-8") return null;
    return /<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096))) ? "image/svg+xml" : null;
  }
  if (kind === "text" || kind === "markdown" || kind === "json" || ext === "csv" || ext === "tsv") {
    const charset = textCharset(bytes);
    if (!charset) return null;
    return `${TEXT_EXT[ext] ?? "text/plain"}; charset=${charset}`;
  }
  return null;
}
