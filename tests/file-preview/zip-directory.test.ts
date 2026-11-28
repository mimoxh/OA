import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readZipDirectory, ZipFormatError, zipTreeRows, type RangeReader } from "@/lib/file-preview/zip-directory";
import { ZIP_MAX_ENTRIES } from "@/lib/file-preview/kinds";

function reader(bytes: Uint8Array) {
  const stats = { reads: 0, bytes: 0 };
  const read: RangeReader = async (start, end) => {
    stats.reads++;
    const part = bytes.subarray(start, Math.min(end, bytes.length));
    stats.bytes += part.length;
    return part;
  };
  return { read, stats };
}

/** 手工拼一个只有中央目录的 ZIP（条目大小随意声明），用来模拟压缩炸弹、GBK 文件名、超多条目 */
function fakeZip(entries: { name: Uint8Array; size: number; compressed: number; flags?: number }[], padding = 0) {
  const cd: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  for (const e of entries) {
    u32(cd, 0x02014b50);
    u16(cd, 20); u16(cd, 20); u16(cd, e.flags ?? 0); u16(cd, 8); u16(cd, 0); u16(cd, 0);
    u32(cd, 0); u32(cd, e.compressed); u32(cd, e.size);
    u16(cd, e.name.length); u16(cd, 0); u16(cd, 0); u16(cd, 0); u16(cd, 0); u32(cd, 0); u32(cd, 0);
    cd.push(...e.name);
  }
  const eocd: number[] = [];
  u32(eocd, 0x06054b50);
  u16(eocd, 0); u16(eocd, 0); u16(eocd, entries.length); u16(eocd, entries.length);
  u32(eocd, cd.length); u32(eocd, padding); u16(eocd, 0);
  const out = new Uint8Array(padding + cd.length + eocd.length);
  out.set(cd, padding);
  out.set(eocd, padding + cd.length);
  return out;
}

test("列出真实 ZIP 的目录（中文文件名、嵌套文件夹），不读取文件内容", async () => {
  const big = new Uint8Array(3 * 1024 * 1024).fill(7);
  const zip = zipSync({
    "报告/季度总结.txt": strToU8("你好"),
    "报告/图片/封面.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    "数据.bin": [big, { level: 0 }],
    "readme.md": strToU8("# hi"),
  });
  const { read, stats } = reader(zip);
  const dir = await readZipDirectory(read, zip.length, ZIP_MAX_ENTRIES);
  assert.equal(dir.total, 4);
  assert.equal(dir.truncated, false);
  assert.equal(dir.suspicious, false);
  assert.deepEqual(dir.entries.map((e) => e.name).sort(), ["readme.md", "报告/图片/封面.png", "报告/季度总结.txt", "数据.bin"].sort());
  assert.equal(dir.entries.find((e) => e.name === "数据.bin")!.size, big.length);
  // 只读了尾部（最多 64 KB 注释区 + 22 字节）和中央目录，没读 3 MB 的内容
  assert.ok(stats.bytes < 70 * 1024, `read ${stats.bytes} bytes`);
  const rows = zipTreeRows(dir.entries);
  assert.deepEqual(
    rows.map((r) => `${"  ".repeat(r.depth)}${r.name}${r.dir ? "/" : ""}`),
    ["报告/", "  图片/", "    封面.png", "  季度总结.txt", "数据.bin", "readme.md"],
  );
});

test("没有 UTF-8 标记的 GBK 文件名（Windows 中文系统打包）正确显示", async () => {
  const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x74, 0x78, 0x74]); // 中文.txt
  const zip = fakeZip([{ name: gbk, size: 10, compressed: 10 }]);
  const dir = await readZipDirectory(reader(zip).read, zip.length, 10);
  assert.equal(dir.entries[0].name, "中文.txt");
});

test("压缩炸弹：只看目录里声明的大小并标记为可疑，不解压", async () => {
  const zip = fakeZip(
    [
      { name: strToU8("bomb-1.bin"), size: 4_000_000_000, compressed: 4_000_000 },
      { name: strToU8("bomb-2.bin"), size: 4_000_000_000, compressed: 4_000_000 },
    ],
    1000,
  );
  const dir = await readZipDirectory(reader(zip).read, zip.length, 10);
  assert.equal(dir.suspicious, true);
  assert.equal(dir.totalSize, 8_000_000_000);
});

test("条目数超过上限时只列出前面一部分", async () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ name: strToU8(`f${i}.txt`), size: 1, compressed: 1 }));
  const zip = fakeZip(entries);
  const dir = await readZipDirectory(reader(zip).read, zip.length, 10);
  assert.equal(dir.entries.length, 10);
  assert.equal(dir.total, 30);
  assert.equal(dir.truncated, true);
});

test("加密条目、路径穿越名称", async () => {
  const zip = fakeZip([
    { name: strToU8("secret.txt"), size: 5, compressed: 5, flags: 1 },
    { name: strToU8("../../etc/passwd"), size: 5, compressed: 5 },
  ]);
  const dir = await readZipDirectory(reader(zip).read, zip.length, 10);
  assert.equal(dir.encrypted, true);
  const rows = zipTreeRows(dir.entries);
  assert.ok(rows.every((r) => !r.path.includes("..")));
  assert.deepEqual(rows.map((r) => r.path), ["etc", "etc/passwd", "secret.txt"]);
});

test("损坏的 ZIP 抛出 ZipFormatError", async () => {
  const junk = new Uint8Array(1000).fill(0x41);
  await assert.rejects(readZipDirectory(reader(junk).read, junk.length, 10), ZipFormatError);
  await assert.rejects(readZipDirectory(reader(new Uint8Array(5)).read, 5, 10), ZipFormatError);
  const zip = zipSync({ "a.txt": strToU8("x") });
  const cut = zip.subarray(0, zip.length - 30);
  await assert.rejects(readZipDirectory(reader(cut).read, cut.length, 10), ZipFormatError);
});
