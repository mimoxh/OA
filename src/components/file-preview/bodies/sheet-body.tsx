"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkBook, WorkSheet } from "xlsx";
import { decodeText, ENCODING_LABEL, type TextEncoding } from "@/lib/file-preview/decode";
import { SHEET_MAX_CELLS, SHEET_MAX_COLS, SHEET_MAX_ROWS } from "@/lib/file-preview/kinds";
import { checkContainer, corrupted, ENCRYPTED_OFFICE, type PreviewFailure } from "@/lib/file-preview/sniff";
import { sheetWindow, columnName, type SheetGrid } from "@/lib/file-preview/sheet-grid";
import { cn } from "@/lib/utils";
import { PreviewError, PreviewLoading, PreviewNotice } from "../preview-states";
import type { PreviewBodyProps } from "../types";
import { useFileBytes } from "../use-file-bytes";

type Xlsx = typeof import("xlsx");
type Book = { xlsx: Xlsx; wb: WorkBook; encoding: TextEncoding | null; hidden: boolean[] };

async function loadBook(bytes: Uint8Array, ext: string): Promise<Book> {
  const xlsx = await import("xlsx");
  if (ext === "xls") {
    // 旧版 .xls（BIFF）里非 Unicode 的文字按代码页存储（中文是 936），需要代码页表
    const cp = await import("xlsx/dist/cpexcel.full.mjs");
    xlsx.set_cptable(cp);
  }
  // sheetRows 让解析库最多读到显示上限，大表不会整表展开占满内存
  const common = { sheetRows: SHEET_MAX_ROWS + 1, cellStyles: false, cellHTML: false, cellFormula: false, bookVBA: false, dense: true } as const;
  let wb: WorkBook;
  let encoding: TextEncoding | null = null;
  if (ext === "csv" || ext === "tsv") {
    const { text, encoding: enc } = decodeText(bytes);
    encoding = enc;
    // raw：单元格保持原文（不把 0012 变成 12、不把日期改格式）
    wb = xlsx.read(text, { ...common, type: "string", raw: true, FS: ext === "tsv" ? "\t" : undefined });
  } else {
    wb = xlsx.read(bytes, { ...common, type: "array", cellDates: true });
  }
  const hidden = wb.SheetNames.map((_, i) => !!wb.Workbook?.Sheets?.[i]?.Hidden);
  return { xlsx, wb, encoding, hidden };
}

function gridOf(book: Book, ws: WorkSheet | undefined): SheetGrid | null {
  if (!ws || !ws["!ref"]) return null;
  const { xlsx } = book;
  const range = xlsx.utils.decode_range(ws["!ref"]);
  const full = ws["!fullref"] ? xlsx.utils.decode_range(ws["!fullref"]) : range;
  const dense = (ws as { "!data"?: ({ v?: unknown; w?: string; t?: string } | undefined)[][] })["!data"];
  return sheetWindow({
    range: { r0: range.s.r, c0: range.s.c, r1: range.e.r, c1: range.e.c },
    fullRows: full.e.r - full.s.r + 1,
    fullCols: full.e.c - full.s.c + 1,
    merges: (ws["!merges"] ?? []).map((m) => ({ r0: m.s.r, c0: m.s.c, r1: m.e.r, c1: m.e.c })),
    cols: (ws["!cols"] ?? []).map((c) => (c?.hidden ? 0 : (c?.wpx ?? (c?.wch ? c.wch * 7 + 10 : null)))),
    cell: (r, c) => {
      const cell = dense ? dense[r]?.[c] : (ws[xlsx.utils.encode_cell({ r, c })] as { v?: unknown; w?: string; t?: string } | undefined);
      if (!cell) return null;
      if (cell.w != null) return cell.w;
      if (cell.v instanceof Date) return cell.v.toLocaleDateString("zh-CN");
      return cell.v == null ? null : String(cell.v);
    },
    numeric: (r, c) => {
      const cell = dense ? dense[r]?.[c] : (ws[xlsx.utils.encode_cell({ r, c })] as { t?: string } | undefined);
      return cell?.t === "n";
    },
    maxRows: SHEET_MAX_ROWS,
    maxCols: SHEET_MAX_COLS,
    maxCells: SHEET_MAX_CELLS,
  });
}

/**
 * 表格（.xlsx / .xls / .ods / .csv）：SheetJS 解析，按工作表显示，底部切换；
 * 容器内横竖滚动，列标题和行号固定；保留合并单元格；超过行列上限只显示前面一部分。
 */
export default function SheetBody({ src, fileName, size, info, downloadHref, dark }: PreviewBodyProps) {
  const bytes = useFileBytes(src, { size });
  const [book, setBook] = useState<Book | null>(null);
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (bytes.kind !== "ready") return;
    const bad = checkContainer(info, bytes.bytes);
    if (bad) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailure(bad);
      return;
    }
    let cancelled = false;
    // 让出一帧，先把「正在解析」画出来再进入同步解析
    const t = setTimeout(() => {
      loadBook(bytes.bytes, info.ext).then(
        (b) => {
          if (cancelled) return;
          setBook(b);
          setActive(Math.max(0, b.hidden.findIndex((h) => !h)));
        },
        (e: unknown) => {
          if (cancelled) return;
          const msg = String((e as Error)?.message ?? e);
          setFailure(/password|encrypt/i.test(msg) ? ENCRYPTED_OFFICE : corrupted(info.label));
        },
      );
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [bytes, info]);

  const grid = useMemo(() => (book ? gridOf(book, book.wb.Sheets[book.wb.SheetNames[active]]) : null), [book, active]);

  if (bytes.kind === "error") return <PreviewError dark={dark} failure={bytes.failure} downloadHref={downloadHref} fileName={fileName} />;
  if (failure) return <PreviewError dark={dark} failure={failure} downloadHref={downloadHref} fileName={fileName} />;
  if (bytes.kind === "loading" || !book) {
    return <PreviewLoading dark={dark} loaded={bytes.kind === "loading" ? bytes.loaded : 0} total={bytes.kind === "loading" ? bytes.total : 0} label={bytes.kind === "ready" ? "正在解析表格…" : undefined} />;
  }

  const names = book.wb.SheetNames;
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      {(grid?.truncated || book.encoding) && (
        <PreviewNotice>
          {grid?.truncated && `表格较大，仅显示前 ${grid.rows.length} 行 × ${grid.colCount} 列（共 ${grid.fullRows} 行 × ${grid.fullCols} 列），完整内容请下载查看。`}
          {grid?.truncated && book.encoding && " "}
          {book.encoding && `文本编码：${ENCODING_LABEL[book.encoding]}`}
        </PreviewNotice>
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" data-sheet-scroller>
        {!grid ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">这个工作表是空的</div>
        ) : (
          <table className="border-separate border-spacing-0 text-[12.5px] text-ink" data-sheet-table>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 h-6 min-w-10 border-b border-r border-line-strong bg-[#f3f3f1]" />
                {grid.colWidths.map((w, i) => (
                  <th
                    key={i}
                    className="sticky top-0 z-20 h-6 border-b border-r border-line-strong bg-[#f3f3f1] px-1 text-center text-[11px] font-medium text-ink-2"
                    style={{ minWidth: w, maxWidth: Math.max(w, 320) }}
                  >
                    {columnName(grid.c0 + i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.r}>
                  <th className="sticky left-0 z-10 border-b border-r border-line-strong bg-[#f3f3f1] px-1.5 text-right text-[11px] font-normal text-ink-2 tabular-nums">
                    {row.r + 1}
                  </th>
                  {row.cells.map((cell) =>
                    cell ? (
                      <td
                        key={cell.c}
                        rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                        colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                        title={cell.text && cell.text.length > 30 ? cell.text : undefined}
                        className={cn(
                          "h-6 max-w-[320px] overflow-hidden text-ellipsis whitespace-pre border-b border-r border-line px-1.5 align-middle",
                          cell.numeric && "text-right tabular-nums",
                          (cell.rowSpan > 1 || cell.colSpan > 1) && "whitespace-pre-wrap text-center",
                          row.r === grid.r0 && "font-medium",
                        )}
                      >
                        {cell.text}
                      </td>
                    ) : null,
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {names.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto overscroll-x-contain border-t border-line bg-[#f3f3f1] px-2 py-1.5" data-sheet-tabs>
          {names.map((n, i) => (
            <button
              key={n + i}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-[13px]",
                i === active ? "bg-white font-medium text-accent shadow-card" : "text-ink-2 hover:bg-hover",
                book.hidden[i] && "italic text-ink-3",
              )}
            >
              {n}
              {book.hidden[i] && "（隐藏）"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
