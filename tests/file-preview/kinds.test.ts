import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSV_LIMIT,
  decidePreview,
  fileExtension,
  isDarkPreview,
  PREVIEW_LIMITS,
  resolvePreview,
} from "@/lib/file-preview/kinds";

const MB = 1024 * 1024;

test("按扩展名分发到预览类型（大小写无关）", () => {
  const cases: [string, string][] = [
    ["报告.pdf", "pdf"],
    ["合同.DOCX", "docx"],
    ["销售.xlsx", "sheet"],
    ["旧表.xls", "sheet"],
    ["导出.csv", "sheet"],
    ["方案.pptx", "pptx"],
    ["README.md", "markdown"],
    ["config.json", "json"],
    ["run.log", "text"],
    ["app.yaml", "text"],
    ["main.ts", "text"],
    ["page.html", "text"],
    ["photo.JPG", "image"],
    ["logo.svg", "svg"],
    ["clip.mp4", "video"],
    ["voice.mp3", "audio"],
    ["bundle.zip", "zip"],
  ];
  for (const [name, kind] of cases) assert.equal(resolvePreview({ fileName: name }).kind, kind, name);
});

test("扩展名优先于 MIME；没有扩展名时才看 MIME", () => {
  assert.equal(resolvePreview({ fileName: "a.txt", mimeType: "application/pdf" }).kind, "text");
  assert.equal(resolvePreview({ fileName: "noext", mimeType: "application/pdf" }).kind, "pdf");
  assert.equal(resolvePreview({ fileName: "noext", mimeType: "video/mp4; codecs=avc1" }).kind, "video");
  assert.equal(resolvePreview({ fileName: "noext", mimeType: "image/svg+xml" }).kind, "svg");
  assert.equal(resolvePreview({ fileName: "noext", mimeType: "application/octet-stream" }).kind, "unsupported");
  assert.equal(fileExtension("dir/a.b.TAR.GZ"), "gz");
  assert.equal(fileExtension("末尾点."), "");
});

test("旧版 Office、RAR 等已知格式给出原因（fallback），未知格式保持直接下载", () => {
  for (const name of ["旧合同.doc", "旧演示.ppt", "资料.rar", "设计.psd", "片段.avi"]) {
    const d = decidePreview({ fileName: name, size: 1000 });
    assert.equal(d.mode, "fallback", name);
    assert.ok(d.mode === "fallback" && d.reason.title.length > 0);
  }
  assert.equal(decidePreview({ fileName: "data.xyz", size: 10 }).mode, "download");
  assert.equal(decidePreview({ fileName: "noext", size: 10 }).mode, "download");
});

test("超过各类型的大小上限时不解析，改为提示下载", () => {
  assert.equal(decidePreview({ fileName: "a.docx", size: PREVIEW_LIMITS.docx! }).mode, "preview");
  const big = decidePreview({ fileName: "a.docx", size: PREVIEW_LIMITS.docx! + 1 });
  assert.equal(big.mode, "fallback");
  assert.match(big.mode === "fallback" ? big.reason.detail : "", /20\.0 MB/);
  assert.equal(decidePreview({ fileName: "a.xlsx", size: 16 * MB }).mode, "fallback");
  assert.equal(decidePreview({ fileName: "a.csv", size: CSV_LIMIT + 1 }).mode, "fallback");
  assert.equal(decidePreview({ fileName: "a.csv", size: CSV_LIMIT }).mode, "preview");
  assert.equal(decidePreview({ fileName: "a.svg", size: 6 * MB }).mode, "fallback");
  // 文本只读开头、ZIP 只读目录、音视频走 Range：不设上限
  assert.equal(decidePreview({ fileName: "a.log", size: 2000 * MB }).mode, "preview");
  assert.equal(decidePreview({ fileName: "a.zip", size: 2000 * MB }).mode, "preview");
  assert.equal(decidePreview({ fileName: "a.mp4", size: 2000 * MB }).mode, "preview");
  assert.equal(decidePreview({ fileName: "a.pdf", size: 2000 * MB }).mode, "preview");
});

test("深色背景只用于 PDF、图片和音视频", () => {
  assert.ok(isDarkPreview("pdf") && isDarkPreview("image") && isDarkPreview("svg") && isDarkPreview("video") && isDarkPreview("audio"));
  assert.ok(!isDarkPreview("docx") && !isDarkPreview("sheet") && !isDarkPreview("text") && !isDarkPreview("zip"));
});
