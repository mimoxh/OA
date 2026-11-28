import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRange, rangeResponseInit } from "@/lib/file-preview/range";
import { columnName, sheetWindow } from "@/lib/file-preview/sheet-grid";

test("Range 解析：普通、开放、后缀、越界与无效写法", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  assert.equal(parseRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=0-", 0), "unsatisfiable");
  assert.equal(parseRange(null, 1000), null);
  assert.equal(parseRange("bytes=0-1,5-9", 1000), null);
  assert.equal(parseRange("items=0-1", 1000), null);
  assert.equal(parseRange("bytes=9-1", 1000), null);
  assert.equal(parseRange("bytes=-", 1000), null);
});

test("Range 响应：206 / 416 / 200 与对应的头", () => {
  const h = { "Content-Type": "video/mp4" };
  const partial = rangeResponseInit("bytes=0-1", 10, h);
  assert.equal(partial.status, 206);
  assert.deepEqual(partial.range, { start: 0, end: 1 });
  assert.equal(partial.headers["Content-Range"], "bytes 0-1/10");
  assert.equal(partial.headers["Content-Length"], "2");
  assert.equal(partial.headers["Accept-Ranges"], "bytes");
  assert.equal(partial.headers["Content-Type"], "video/mp4");
  const bad = rangeResponseInit("bytes=20-", 10, h);
  assert.equal(bad.status, 416);
  assert.equal(bad.headers["Content-Range"], "bytes */10");
  const full = rangeResponseInit(null, 10, h);
  assert.equal(full.status, 200);
  assert.equal(full.headers["Content-Length"], "10");
  assert.equal(full.headers["Accept-Ranges"], "bytes");
});

test("表格窗口：行、列、单元格上限与合并单元格", () => {
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(26), "AA");
  assert.equal(columnName(701), "ZZ");
  assert.equal(columnName(702), "AAA");

  const grid = sheetWindow({
    range: { r0: 0, c0: 0, r1: 4999, c1: 199 },
    fullRows: 5000,
    fullCols: 200,
    merges: [{ r0: 0, c0: 0, r1: 1, c1: 2 }, { r0: 5000, c0: 0, r1: 5001, c1: 1 }],
    cols: [],
    cell: (r, c) => `${r},${c}`,
    maxRows: 1000,
    maxCols: 100,
    maxCells: 40_000,
  });
  assert.equal(grid.colCount, 100);
  assert.equal(grid.rows.length, 400); // 40000 / 100 列
  assert.equal(grid.truncated, true);
  assert.equal(grid.fullRows, 5000);
  const top = grid.rows[0].cells[0]!;
  assert.equal(top.rowSpan, 2);
  assert.equal(top.colSpan, 3);
  assert.equal(grid.rows[0].cells[1], null);
  assert.equal(grid.rows[1].cells[2], null);
  assert.equal(grid.rows[1].cells[3]!.text, "1,3");

  const small = sheetWindow({
    range: { r0: 2, c0: 1, r1: 3, c1: 2 },
    fullRows: 2,
    fullCols: 2,
    merges: [{ r0: 0, c0: 0, r1: 2, c1: 1 }],
    cols: [0, 0, 10, 1000],
    cell: () => null,
    maxRows: 1000,
    maxCols: 100,
    maxCells: 40_000,
  });
  assert.equal(small.truncated, false);
  // 合并区域被窗口裁剪：从窗口左上角开始
  assert.equal(small.rows[0].cells[0]!.rowSpan, 1);
  assert.equal(small.rows[0].cells[0]!.text, "");
  assert.deepEqual(small.colWidths, [24, 48]);
});
