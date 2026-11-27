/**
 * 按文件头判断容器格式，在交给解析库之前识别出加密 / 损坏 / 改了扩展名的文件，给出明确原因。
 */
import type { PreviewInfo } from "./kinds";

export type PreviewFailure = { title: string; detail: string };

const head = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

export const isZip = (b: Uint8Array) => head(b, [0x50, 0x4b, 0x03, 0x04]) || head(b, [0x50, 0x4b, 0x05, 0x06]);
/** OLE 复合文档：旧版 .doc / .xls / .ppt，以及加密后的 .docx / .xlsx / .pptx */
export const isCfb = (b: Uint8Array) => head(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export const isPdf = (b: Uint8Array) => b.length >= 5 && String.fromCharCode(...b.subarray(0, 5)) === "%PDF-";

export const ENCRYPTED_OFFICE: PreviewFailure = {
  title: "文件已加密",
  detail: "这个 Office 文件设置了打开密码，无法在线预览。可以下载后用 Office / WPS 输入密码查看。",
};

export function corrupted(label: string): PreviewFailure {
  return { title: "无法解析该文件", detail: `文件已损坏，或者不是有效的${label}。可以下载后用其他应用尝试打开。` };
}

/** 解析前的容器检查；没问题返回 null */
export function checkContainer(info: Pick<PreviewInfo, "kind" | "ext" | "label">, bytes: Uint8Array): PreviewFailure | null {
  if (bytes.length === 0) return { title: "文件是空的", detail: "文件大小为 0，没有可以显示的内容。" };
  const ooxml = info.kind === "docx" || info.kind === "pptx" || (info.kind === "sheet" && (info.ext === "xlsx" || info.ext === "xlsm"));
  if (ooxml) {
    if (isCfb(bytes)) {
      // 表格库能读改了扩展名的 .xls，交给它判断；Word / 演示文稿的 OLE 容器只可能是加密文件或旧版格式
      if (info.kind === "sheet") return null;
      return ENCRYPTED_OFFICE;
    }
    if (!isZip(bytes)) return corrupted(info.label);
  }
  if (info.kind === "zip" && !isZip(bytes)) return corrupted("ZIP 压缩包");
  return null;
}
