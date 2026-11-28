import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * pdf.js 运行时资源（手机端 PDF 预览用）：worker、CMap、标准字体、图像解码 wasm、ICC 配置。
 * 直接读依赖包里的文件（standalone 打包时由 scripts/desktop/pdfjs-assets.mjs 复制进产物），只放行白名单内的文件名。
 */
const PKG = path.join(process.cwd(), "node_modules", "pdfjs-dist");

const DIRS: Record<string, { re: RegExp; dir: string }> = {
  cmaps: { re: /^[\w.-]+\.bcmap$/, dir: "cmaps" },
  standard_fonts: { re: /^[\w-]+\.(?:pfb|ttf)$/, dir: "standard_fonts" },
  wasm: { re: /^[\w-]+\.(?:wasm|js)$/, dir: "wasm" },
  iccs: { re: /^[\w.-]+\.icc$/, dir: "iccs" },
};

const TYPES: Record<string, string> = {
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
};

export async function GET(_req: Request, ctx: RouteContext<"/api/pdfjs/[...path]">) {
  const parts = (await ctx.params).path;
  let file: string | null = null;
  if (parts.length === 1 && parts[0] === "worker") {
    file = path.join(PKG, "legacy", "build", "pdf.worker.min.mjs");
  } else if (parts.length === 2 && DIRS[parts[0]]?.re.test(parts[1])) {
    file = path.join(PKG, DIRS[parts[0]].dir, parts[1]);
  }
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": String(data.byteLength),
      // worker 地址带 ?v=<pdf.js 版本>，升级后自然换地址
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
