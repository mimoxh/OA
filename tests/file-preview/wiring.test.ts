import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

test("预览窗口在手机全屏时让出状态栏和导航栏，标题栏有关闭和下载", () => {
  const s = src("src/components/file-preview/file-preview-dialog.tsx");
  assert.match(s, /pt-\[var\(--sat\)\]/);
  assert.match(s, /mb-\[var\(--sab\)\]/);
  assert.match(s, /D\.Close[^>]*aria-label="关闭"/);
  assert.match(s, /data-preview-download/);
  // Radix Dialog：Android 返回键由 AppRuntime 转成 Esc 关闭
  assert.match(s, /from "radix-ui"/);
});

test("各格式渲染器按需加载（dynamic import），不进首屏包", () => {
  const s = src("src/components/file-preview/file-preview-dialog.tsx");
  for (const body of ["pdf", "docx", "sheet", "pptx", "text", "image", "media", "zip"]) {
    assert.match(s, new RegExp(`lazy\\(\\(\\) => import\\("\\./bodies/${body}-body"\\)\\)`), body);
  }
  for (const file of ["src/components/im/message-item.tsx", "src/components/docs/editor/file-attachment.tsx", "src/components/file-preview/file-preview-dialog.tsx"]) {
    const s2 = src(file);
    assert.doesNotMatch(s2, /from "(docx-preview|xlsx|jszip|marked|pdfjs-dist[^"]*)"/, file);
  }
});

test("IM 文件消息与文档附件都使用统一预览窗口", () => {
  assert.match(src("src/components/im/message-item.tsx"), /<FilePreviewDialog/);
  assert.match(src("src/components/docs/editor/file-attachment.tsx"), /<FilePreviewDialog/);
});

test("文件接口支持 Range，SVG 不内联返回", () => {
  const im = src("src/app/api/im/files/[id]/route.ts");
  const docs = src("src/app/api/docs/attachments/[id]/route.ts");
  assert.match(im, /rangeResponseInit/);
  assert.match(docs, /rangeResponseInit/);
  assert.match(docs, /svg \? "application\/octet-stream"/);
  assert.match(im, /nosniff/);
});
