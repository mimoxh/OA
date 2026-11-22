"use client";

import { useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { parseCsv, serializeDatabaseCsv } from "@/lib/docs/database/csv";
import { isDateValue } from "@/lib/docs/database/date-cells";
import { activeProperties, makeId } from "@/lib/docs/database/engine";
import {
  isStoredPropertyType,
  type DatabaseRow,
  type PersonOption,
  type PropertyDefinition,
  type PropertyValue,
} from "@/lib/docs/database/types";

export function downloadDatabaseCsv(
  title: string,
  properties: readonly PropertyDefinition[],
  rows: readonly DatabaseRow[],
  members: readonly PersonOption[],
) {
  const csv = serializeDatabaseCsv(properties, rows, members);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "多维表格").replace(/[\\/:*?"<>|]/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ColumnTarget = "skip" | "title" | "new_text" | `prop:${string}`;

export function CsvImportDialog({
  open,
  onOpenChange,
  databaseId,
  properties,
  members,
  onAddNewProperties,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  databaseId: string;
  properties: PropertyDefinition[];
  members: PersonOption[];
  onAddNewProperties: (newProps: PropertyDefinition[]) => Promise<PropertyDefinition[]>;
  onImported: () => Promise<void>;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [bodyRows, setBodyRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [importing, setImporting] = useState(false);

  const active = activeProperties(properties);
  const writableProps = active.filter((p) => isStoredPropertyType(p.type));

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      toast.error("CSV 文件至少需要表头和一行数据");
      return;
    }
    const hdr = parsed[0].map((s, i) => s.trim() || `列 ${i + 1}`);
    const data = parsed.slice(1, 501);
    setHeaders(hdr);
    setBodyRows(data);

    // Auto-map columns by name
    let titleAssigned = false;
    const auto: ColumnTarget[] = hdr.map((col, idx): ColumnTarget => {
      const exact = active.find((p) => p.name.toLowerCase() === col.toLowerCase());
      if (exact?.type === "title" && !titleAssigned) {
        titleAssigned = true;
        return "title";
      }
      if (exact && isStoredPropertyType(exact.type)) {
        return `prop:${exact.id}`;
      }
      if (idx === 0 && !titleAssigned) {
        titleAssigned = true;
        return "title";
      }
      return "new_text";
    });
    setMapping(auto);
  };

  const handleImport = async () => {
    if (bodyRows.length === 0) return;
    setImporting(true);
    try {
      // 1. Create any newly requested text properties first
      const newPropDefs: PropertyDefinition[] = [];
      const colToNewPropId = new Map<number, string>();
      mapping.forEach((m, idx) => {
        if (m === "new_text") {
          const id = makeId("prop");
          newPropDefs.push({ id, name: headers[idx].slice(0, 100), type: "text" });
          colToNewPropId.set(idx, id);
        }
      });

      let latestProps = properties;
      if (newPropDefs.length > 0) {
        latestProps = await onAddNewProperties(newPropDefs);
      }
      const propsById = new Map(latestProps.map((p) => [p.id, p]));
      const membersByName = new Map(members.map((m) => [m.name.toLowerCase(), m.id]));

      // 2. Transform CSV rows into database row payloads
      const rowsPayload = bodyRows.map((cells) => {
        let title = "";
        const propVals: Record<string, PropertyValue | null> = {};

        mapping.forEach((target, idx) => {
          const raw = (cells[idx] ?? "").trim();
          if (!raw || target === "skip") return;
          if (target === "title") {
            title = raw;
            return;
          }
          const propId = target === "new_text" ? colToNewPropId.get(idx) : target.slice(5);
          if (!propId) return;
          const def = propsById.get(propId);
          if (!def) return;

          switch (def.type) {
            case "text":
            case "url":
              propVals[propId] = raw;
              break;
            case "number": {
              const n = Number(raw.replace(/,/g, ""));
              if (Number.isFinite(n)) propVals[propId] = n;
              break;
            }
            case "checkbox":
              propVals[propId] = ["true", "1", "yes", "是", "✓"].includes(raw.toLowerCase());
              break;
            case "date":
              if (isDateValue(raw)) propVals[propId] = raw;
              break;
            case "select": {
              const opt = (def.options ?? []).find((o) => o.name.toLowerCase() === raw.toLowerCase());
              if (opt) propVals[propId] = opt.id;
              break;
            }
            case "multi_select": {
              const parts = raw.split(/[,，;；]/).map((s) => s.trim().toLowerCase());
              const ids = parts
                .map((name) => (def.options ?? []).find((o) => o.name.toLowerCase() === name)?.id)
                .filter((x): x is string => !!x);
              if (ids.length) propVals[propId] = ids;
              break;
            }
            case "person": {
              const mid = membersByName.get(raw.toLowerCase());
              if (mid) propVals[propId] = mid;
              break;
            }
          }
        });

        return { title: title || "未命名记录", properties: propVals };
      });

      const res = await fetch(`/api/docs/databases/${databaseId}/rows/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", rows: rowsPayload }),
      });
      const data = (await res.json()) as { imported?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "导入失败");
      toast.success(`已导入 ${data.imported ?? rowsPayload.length} 条记录`);
      await onImported();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CSV 导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="从 CSV 导入记录"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="default" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={bodyRows.length === 0} loading={importing} onClick={handleImport}>
              导入 {bodyRows.length > 0 ? `${bodyRows.length} 行` : ""}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-sidebar/40 px-4 py-6 text-ink-2 hover:bg-hover/40">
            <Upload className="size-5 text-ink-3" />
            <span className="font-medium text-ink">点击选择 CSV 文件（UTF-8，单次最多导入 500 行）</span>
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          </label>

          {headers.length > 0 && (
            <>
              <div className="flex items-center justify-between text-ink-2">
                <span>检测到 {headers.length} 列、{bodyRows.length} 行数据，请确认列映射：</span>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-line p-2.5">
                {headers.map((h, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-40 truncate font-medium text-ink" title={h}>
                      {h}
                    </span>
                    <span className="text-ink-3">→</span>
                    <select
                      value={mapping[idx] ?? "skip"}
                      onChange={(e) =>
                        setMapping((prev) => prev.map((m, i) => (i === idx ? (e.target.value as ColumnTarget) : m)))
                      }
                      className="h-7 flex-1 rounded border border-line bg-white px-2"
                    >
                      <option value="skip">跳过此列</option>
                      <option value="title">映射到：标题列</option>
                      <option value="new_text">新建文本字段「{h}」</option>
                      {writableProps.map((p) => (
                        <option key={p.id} value={`prop:${p.id}`}>
                          映射到已有字段：{p.name}
                        </option>
                      ))}
                    </select>
                    <span className="w-32 truncate text-ink-3" title={bodyRows[0]?.[idx]}>
                      示例：{bodyRows[0]?.[idx] || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
