/**
 * 文本解码：自动识别 UTF-8 / UTF-16（带 BOM）/ GB18030（兼容 GBK、GB2312），避免中文乱码。
 */

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "gb18030";

function hasPrefix(b: Uint8Array, p: number[]) {
  return b.length >= p.length && p.every((v, i) => b[i] === v);
}

/** 判断编码。truncated 表示只读了文件开头，末尾可能截断在多字节字符中间 */
export function detectTextEncoding(bytes: Uint8Array, truncated = false): { encoding: TextEncoding; bom: number } {
  if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) return { encoding: "utf-8", bom: 3 };
  if (hasPrefix(bytes, [0xff, 0xfe])) return { encoding: "utf-16le", bom: 2 };
  if (hasPrefix(bytes, [0xfe, 0xff])) return { encoding: "utf-16be", bom: 2 };
  try {
    // stream: true 时末尾不完整的 UTF-8 序列不算错误（只读了文件开头时会出现）
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated });
    return { encoding: "utf-8", bom: 0 };
  } catch {
    return { encoding: "gb18030", bom: 0 };
  }
}

export function decodeText(bytes: Uint8Array, truncated = false): { text: string; encoding: TextEncoding } {
  const { encoding, bom } = detectTextEncoding(bytes, truncated);
  const body = bom ? bytes.subarray(bom) : bytes;
  // 非严格解码：GB18030 里个别非法字节显示为替换字符，不中断预览
  const text = new TextDecoder(encoding).decode(body, { stream: truncated });
  return { text, encoding };
}

/** 前 8 KB 里有 NUL 字节（且不是 UTF-16）视为二进制文件，不当文本显示 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (hasPrefix(bytes, [0xff, 0xfe]) || hasPrefix(bytes, [0xfe, 0xff])) return false;
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export const ENCODING_LABEL: Record<TextEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  gb18030: "GBK / GB18030",
};
