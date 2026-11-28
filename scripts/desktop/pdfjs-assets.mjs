/**
 * 手机端 PDF 预览（/api/pdfjs）在运行时从 node_modules/pdfjs-dist 读取 worker、CMap、标准字体与解码器。
 * 这些文件不被服务端代码 import，standalone 追踪不到；打包时按白名单复制到产物的 node_modules/pdfjs-dist（约 4 MB）。
 */
import fs from "node:fs";
import path from "node:path";

export const PDFJS_RUNTIME_FILES = [
  "package.json",
  "LICENSE",
  "legacy/build/pdf.worker.min.mjs",
  "cmaps",
  "standard_fonts",
  "wasm",
  "iccs",
];

/** @param {string} root 仓库根目录  @param {string} appDir 产物目录（其下的 node_modules/pdfjs-dist） */
export function copyPdfjsAssets(root, appDir) {
  const src = fs.realpathSync(path.join(root, "node_modules/pdfjs-dist"));
  const dst = path.join(appDir, "node_modules/pdfjs-dist");
  fs.rmSync(dst, { recursive: true, force: true });
  for (const rel of PDFJS_RUNTIME_FILES) {
    const from = path.join(src, rel);
    if (!fs.existsSync(from)) throw new Error(`pdfjs-dist 缺少 ${rel}`);
    fs.mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true });
    fs.cpSync(from, path.join(dst, rel), { recursive: true });
  }
}
