import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeText, detectTextEncoding, looksBinary } from "@/lib/file-preview/decode";
import { checkContainer, ENCRYPTED_OFFICE } from "@/lib/file-preview/sniff";
import { resolvePreview } from "@/lib/file-preview/kinds";

const utf8 = (s: string) => new TextEncoder().encode(s);
// 「中文，测试」的 GBK 编码
const GBK = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xa3, 0xac, 0xb2, 0xe2, 0xca, 0xd4]);

test("UTF-8（含 BOM）与 GBK 自动识别", () => {
  assert.deepEqual(decodeText(utf8("姓名,金额\n王芳,100")), { text: "姓名,金额\n王芳,100", encoding: "utf-8" });
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("中文")]);
  assert.deepEqual(decodeText(bom), { text: "中文", encoding: "utf-8" });
  assert.deepEqual(decodeText(GBK), { text: "中文，测试", encoding: "gb18030" });
});

test("UTF-16 带 BOM", () => {
  const le = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]);
  assert.deepEqual(decodeText(le), { text: "中文", encoding: "utf-16le" });
  const be = new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]);
  assert.deepEqual(decodeText(be), { text: "中文", encoding: "utf-16be" });
  assert.equal(looksBinary(le), false);
});

test("只读了开头、截断在多字节字符中间时仍识别为 UTF-8", () => {
  const full = utf8("测试文本".repeat(10));
  const cut = full.subarray(0, full.length - 1);
  assert.equal(detectTextEncoding(cut, true).encoding, "utf-8");
  assert.equal(detectTextEncoding(cut, false).encoding, "gb18030");
  assert.equal(decodeText(cut, true).text, "测试文本".repeat(9) + "测试文");
});

test("二进制内容不当文本显示", () => {
  assert.equal(looksBinary(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])), true);
  assert.equal(looksBinary(utf8("普通文本")), false);
});

test("容器检查：加密 / 损坏 / 改扩展名 / 空文件", () => {
  const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const docx = resolvePreview({ fileName: "a.docx" });
  const pptx = resolvePreview({ fileName: "a.pptx" });
  const xlsx = resolvePreview({ fileName: "a.xlsx" });
  const zipInfo = resolvePreview({ fileName: "a.zip" });
  assert.deepEqual(checkContainer(docx, cfb), ENCRYPTED_OFFICE);
  assert.deepEqual(checkContainer(pptx, cfb), ENCRYPTED_OFFICE);
  // 表格库能读改了扩展名的 .xls，交给它判断
  assert.equal(checkContainer(xlsx, cfb), null);
  assert.equal(checkContainer(docx, zip), null);
  assert.match(checkContainer(docx, utf8("not a docx"))!.title, /无法解析/);
  assert.match(checkContainer(zipInfo, utf8("not a zip"))!.title, /无法解析/);
  assert.match(checkContainer(docx, new Uint8Array(0))!.title, /空/);
});
