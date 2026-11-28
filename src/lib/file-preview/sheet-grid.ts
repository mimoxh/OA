/**
 * 表格预览的显示窗口：在行、列、单元格总数上限内取出要渲染的区域，并把合并单元格换算成 rowSpan / colSpan。
 * 纯函数，不依赖表格解析库，便于单元测试。
 */

export type Rect = { r0: number; c0: number; r1: number; c1: number };
export type GridCell = { c: number; text: string; rowSpan: number; colSpan: number; numeric: boolean };
export type SheetGrid = {
  r0: number;
  c0: number;
  colCount: number;
  colWidths: number[];
  /** cells 里 null 表示被合并单元格覆盖（不渲染 td） */
  rows: { r: number; cells: (GridCell | null)[] }[];
  fullRows: number;
  fullCols: number;
  truncated: boolean;
};

export function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function sheetWindow(input: {
  range: Rect;
  fullRows: number;
  fullCols: number;
  merges: Rect[];
  cols: (number | null)[];
  cell: (r: number, c: number) => string | null;
  numeric?: (r: number, c: number) => boolean;
  maxRows: number;
  maxCols: number;
  maxCells: number;
}): SheetGrid {
  const { range, merges, maxRows, maxCols, maxCells } = input;
  const totalCols = range.c1 - range.c0 + 1;
  const colCount = Math.max(1, Math.min(totalCols, maxCols));
  const rowLimit = Math.max(1, Math.min(maxRows, Math.floor(maxCells / colCount)));
  const rowCount = Math.max(1, Math.min(range.r1 - range.r0 + 1, rowLimit));
  const r1 = range.r0 + rowCount - 1;
  const c1 = range.c0 + colCount - 1;

  const spans = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();
  for (const m of merges) {
    if (m.r0 > r1 || m.c0 > c1 || m.r1 < range.r0 || m.c1 < range.c0) continue;
    const top = Math.max(m.r0, range.r0);
    const left = Math.max(m.c0, range.c0);
    const bottom = Math.min(m.r1, r1);
    const right = Math.min(m.c1, c1);
    spans.set(`${top}:${left}`, { rowSpan: bottom - top + 1, colSpan: right - left + 1 });
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) if (r !== top || c !== left) covered.add(`${r}:${c}`);
  }

  const rows: SheetGrid["rows"] = [];
  for (let r = range.r0; r <= r1; r++) {
    const cells: (GridCell | null)[] = [];
    for (let c = range.c0; c <= c1; c++) {
      const key = `${r}:${c}`;
      if (covered.has(key)) {
        cells.push(null);
        continue;
      }
      const span = spans.get(key);
      cells.push({ c, text: input.cell(r, c) ?? "", rowSpan: span?.rowSpan ?? 1, colSpan: span?.colSpan ?? 1, numeric: input.numeric?.(r, c) ?? false });
    }
    rows.push({ r, cells });
  }
  const colWidths: number[] = [];
  for (let c = range.c0; c <= c1; c++) {
    const w = input.cols[c];
    colWidths.push(w === 0 ? 24 : Math.max(48, Math.min(320, Math.round(w ?? 80))));
  }
  return {
    r0: range.r0,
    c0: range.c0,
    colCount,
    colWidths,
    rows,
    fullRows: Math.max(input.fullRows, rowCount),
    fullCols: Math.max(input.fullCols, colCount),
    truncated: input.fullRows > rowCount || input.fullCols > colCount,
  };
}
