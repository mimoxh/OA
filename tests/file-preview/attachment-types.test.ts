import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffMediaType } from "@/lib/docs/attachment-types";

const utf8 = (s: string) => new TextEncoder().encode(s);
const bytes = (...v: (number | string)[]) => new Uint8Array(v.flatMap((x) => (typeof x === "string" ? [...utf8(x)] : [x])));

test("文档附件：二进制格式要求签名与扩展名一致", () => {
  assert.equal(sniffMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0), "a.png"), "image/png");
  assert.equal(sniffMediaType(bytes("%PDF-1.7"), "a.pdf"), "application/pdf");
  assert.equal(sniffMediaType(bytes(0x50, 0x4b, 0x03, 0x04), "a.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(sniffMediaType(bytes(0x50, 0x4b, 0x03, 0x04), "a.zip"), "application/zip");
  const cfb = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0);
  assert.equal(sniffMediaType(cfb, "旧表.xls"), "application/vnd.ms-excel");
  assert.equal(sniffMediaType(cfb, "旧合同.doc"), "application/msword");
  assert.equal(sniffMediaType(cfb, "加密.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(sniffMediaType(cfb, "a.exe"), null);
  assert.equal(sniffMediaType(bytes(0, 0, 0, 0x20, "ftypisom", 0), "clip.mp4"), "video/mp4");
  assert.equal(sniffMediaType(bytes("ID3", 4, 0), "voice.mp3"), "audio/mpeg");
  assert.equal(sniffMediaType(bytes(0xff, 0xfb, 0x90, 0x00), "voice.mp3"), "audio/mpeg");
  assert.equal(sniffMediaType(bytes("RIFF", 0, 0, 0, 0, "WAVE"), "a.wav"), "audio/wav");
  assert.equal(sniffMediaType(bytes(0x1a, 0x45, 0xdf, 0xa3), "a.webm"), "video/webm");
  // 扩展名对、签名不对
  assert.equal(sniffMediaType(bytes("hello"), "clip.mp4"), null);
  assert.equal(sniffMediaType(bytes(0x4d, 0x5a, 0x90, 0), "setup.exe"), null);
});

test("文档附件：文本类接受 UTF-8 与 GBK，拒绝二进制", () => {
  assert.equal(sniffMediaType(utf8("a,b\n1,2"), "a.csv"), "text/csv; charset=utf-8");
  assert.equal(sniffMediaType(bytes(0xd6, 0xd0, 0xce, 0xc4, 0x2c, 0x31), "gbk.csv"), "text/csv; charset=gb18030");
  assert.equal(sniffMediaType(utf8("# t"), "a.md"), "text/markdown; charset=utf-8");
  assert.equal(sniffMediaType(utf8("{}"), "a.json"), "application/json; charset=utf-8");
  assert.equal(sniffMediaType(utf8("k: v"), "a.yaml"), "text/plain; charset=utf-8");
  assert.equal(sniffMediaType(utf8("console.log(1)"), "a.ts"), "text/plain; charset=utf-8");
  // HTML 只当纯文本保存，下载接口不会把它当网页返回
  assert.equal(sniffMediaType(utf8("<script>alert(1)</script>"), "a.html"), "text/plain; charset=utf-8");
  assert.equal(sniffMediaType(bytes("ab", 0, "cd"), "a.txt"), null);
  assert.equal(sniffMediaType(utf8("plain"), "a.unknownext"), null);
});

test("文档附件：SVG 必须是 UTF-8 且包含 <svg> 根元素", () => {
  assert.equal(sniffMediaType(utf8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), "logo.svg"), "image/svg+xml");
  assert.equal(sniffMediaType(utf8("<html><script>alert(1)</script></html>"), "fake.svg"), null);
});
