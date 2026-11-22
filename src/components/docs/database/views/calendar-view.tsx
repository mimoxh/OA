"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, dateCellRange, localDay } from "@/lib/docs/database/date-cells";
import { cellValue, isCalendarProperty } from "@/lib/docs/database/engine";
import {
  effectiveType,
  type DatabaseRow,
  type DatabaseView,
  type PropertyDefinition,
  type PropertyValue,
} from "@/lib/docs/database/types";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

interface CalendarItem {
  row: DatabaseRow;
  start: string;
  end: string;
}

export function CalendarView({
  properties,
  view,
  rows,
  canWrite,
  onOpenRow,
  onCreateRowWithProps,
}: {
  properties: PropertyDefinition[];
  view: DatabaseView;
  rows: DatabaseRow[];
  canWrite: boolean;
  onOpenRow: (rowId: string) => void;
  onCreateRowWithProps: (initialProps: Record<string, PropertyValue | null>) => void;
}) {
  const today = useMemo(() => localDay(new Date()), []);
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));

  const dateDef =
    properties.find((p) => p.id === view.datePropertyId && isCalendarProperty(p)) ??
    properties.find((p) => isCalendarProperty(p));

  const weeks = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
    const firstDayStr = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-01`;
    const dow = (first.getUTCDay() + 6) % 7; // Monday = 0
    const gridStart = addDays(firstDayStr, -dow);
    const out: string[][] = [];
    for (let w = 0; w < 6; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(addDays(gridStart, w * 7 + d));
      }
      // Drop 6th week if completely in next month
      if (w === 5 && Number(week[0].slice(5, 7)) - 1 !== cursor.month) break;
      out.push(week);
    }
    return out;
  }, [cursor.year, cursor.month]);

  const items: CalendarItem[] = useMemo(() => {
    if (!dateDef) return [];
    const eff = effectiveType(dateDef);
    const out: CalendarItem[] = [];
    for (const row of rows) {
      const val = cellValue(row, dateDef);
      if (val === undefined) continue;
      if (eff === "created_time" || eff === "updated_time") {
        const d = new Date(String(val));
        if (!Number.isNaN(d.getTime())) {
          const day = localDay(d);
          out.push({ row, start: day, end: day });
        }
      } else {
        const range = dateCellRange(val);
        if (range) out.push({ row, start: range.start, end: range.end });
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  }, [rows, dateDef]);

  if (!dateDef) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-sidebar/40 p-8 text-center text-xs text-ink-3">
        日历视图需要至少一个「日期 / 创建时间 / 更新时间」字段，请先添加日期字段。
      </div>
    );
  }

  const canCreateOnDay = canWrite && dateDef.type === "date";
  const shiftMonth = (delta: number) => {
    const dt = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    setCursor({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line bg-sidebar/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">
            {cursor.year} 年 {cursor.month + 1} 月
          </span>
          <span className="text-xs text-ink-3">按「{dateDef.name}」展示</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="flex size-7 items-center justify-center rounded border border-line bg-white text-ink-2 hover:bg-hover"
            aria-label="上个月"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })}
            className="h-7 rounded border border-line bg-white px-2.5 text-xs text-ink-2 hover:bg-hover"
          >
            今天
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="flex size-7 items-center justify-center rounded border border-line bg-white text-ink-2 hover:bg-hover"
            aria-label="下个月"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-line bg-sidebar/30 text-center text-[11px] font-medium text-ink-3">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-r border-line/60 py-1.5 last:border-r-0">
            {w}
          </div>
        ))}
      </div>

      <div className="divide-y divide-line">
        {weeks.map((week, wIdx) => {
          const weekStart = week[0];
          const weekEnd = week[6];
          // Pack spanning items into horizontal lanes for this week
          const weekItems = items.filter((it) => it.start <= weekEnd && it.end >= weekStart);
          const lanes: { item: CalendarItem; colStart: number; colSpan: number }[][] = [];
          for (const item of weekItems) {
            const clippedStart = item.start < weekStart ? weekStart : item.start;
            const clippedEnd = item.end > weekEnd ? weekEnd : item.end;
            const colStart = week.indexOf(clippedStart);
            const colEnd = week.indexOf(clippedEnd);
            if (colStart < 0 || colEnd < 0) continue;
            const colSpan = colEnd - colStart + 1;

            let placed = false;
            for (const lane of lanes) {
              const conflict = lane.some(
                (seg) => !(colStart + colSpan <= seg.colStart || seg.colStart + seg.colSpan <= colStart),
              );
              if (!conflict) {
                lane.push({ item, colStart, colSpan });
                placed = true;
                break;
              }
            }
            if (!placed) lanes.push([{ item, colStart, colSpan }]);
          }

          return (
            <div key={wIdx} className="relative min-h-[110px]">
              {/* Day cells background */}
              <div className="grid grid-cols-7">
                {week.map((day) => {
                  const inMonth = Number(day.slice(5, 7)) - 1 === cursor.month;
                  const isToday = day === today;
                  return (
                    <div
                      key={day}
                      className={cn(
                        "group/day min-h-[110px] border-r border-line/60 p-1.5 last:border-r-0",
                        !inMonth && "bg-sidebar/30",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full text-xs",
                            isToday
                              ? "bg-accent font-semibold text-white"
                              : inMonth
                                ? "text-ink"
                                : "text-ink-3",
                          )}
                        >
                          {Number(day.slice(8, 10))}
                        </span>
                        {canCreateOnDay && (
                          <button
                            type="button"
                            onClick={() => onCreateRowWithProps({ [dateDef.id]: day })}
                            className="flex size-5 items-center justify-center rounded text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover/day:opacity-100"
                            title={`在 ${day} 新建记录`}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Spanning bars overlay */}
              {lanes.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 top-8 space-y-1 px-1">
                  {lanes.slice(0, 4).map((lane, lIdx) => (
                    <div key={lIdx} className="grid grid-cols-7 gap-1">
                      {lane.map((seg) => {
                        const isSpan = seg.item.start !== seg.item.end;
                        return (
                          <button
                            key={`${seg.item.row.id}:${seg.colStart}`}
                            type="button"
                            style={{ gridColumn: `${seg.colStart + 1} / span ${seg.colSpan}` }}
                            onClick={() => onOpenRow(seg.item.row.id)}
                            className={cn(
                              "pointer-events-auto flex h-5 items-center gap-1 truncate rounded px-1.5 text-left text-[11px] font-medium transition-colors",
                              isSpan
                                ? "bg-accent text-white hover:opacity-90"
                                : "border border-line bg-white text-ink shadow-2xs hover:border-accent",
                            )}
                            title={`${seg.item.row.title || "无标题"} (${seg.item.start}${isSpan ? ` → ${seg.item.end}` : ""})`}
                          >
                            {seg.item.row.icon && <span className="shrink-0">{seg.item.row.icon}</span>}
                            <span className="truncate">{seg.item.row.title || "无标题"}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {lanes.length > 4 && (
                    <div className="px-1 text-[10px] text-ink-3">另有 {lanes.length - 4} 行排期…</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
