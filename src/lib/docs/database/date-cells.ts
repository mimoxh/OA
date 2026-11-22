export interface DayRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD (inclusive)
}

export interface ParsedDateCell {
  start: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD
}

export const RELATIVE_DATE_TOKENS = [
  "today",
  "yesterday",
  "tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "this_month",
  "last_month",
  "next_month",
  "last_7_days",
  "last_30_days",
  "next_7_days",
  "next_30_days",
] as const;
export type RelativeDateToken = (typeof RELATIVE_DATE_TOKENS)[number];

export const RELATIVE_DATE_LABEL: Record<RelativeDateToken, string> = {
  today: "今天",
  yesterday: "昨天",
  tomorrow: "明天",
  this_week: "本周",
  last_week: "上周",
  next_week: "下周",
  this_month: "本月",
  last_month: "上月",
  next_month: "下月",
  last_7_days: "过去 7 天",
  last_30_days: "过去 30 天",
  next_7_days: "未来 7 天",
  next_30_days: "未来 30 天",
};

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})(?:\/(\d{4}-\d{2}-\d{2}))?$/;

export function isValidDay(day: string): boolean {
  const m = DAY_RE.exec(day);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseDateCell(value: unknown): ParsedDateCell | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept ISO timestamp strings by taking date part
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const day = trimmed.slice(0, 10);
    return isValidDay(day) ? { start: day } : null;
  }
  const m = RANGE_RE.exec(trimmed);
  if (!m) return null;
  const start = m[1];
  const end = m[2];
  if (!isValidDay(start)) return null;
  if (end) {
    if (!isValidDay(end)) return null;
    if (end < start) return { start: end, end: start };
    if (end === start) return { start };
    return { start, end };
  }
  return { start };
}

export function isDateValue(value: unknown): value is string {
  return parseDateCell(value) !== null;
}

export function formatDateCell(start: string, end?: string | null): string {
  if (!end || end === start) return start;
  return end < start ? `${end}/${start}` : `${start}/${end}`;
}

export function displayDateCell(value: unknown): string {
  const p = parseDateCell(value);
  if (!p) return "";
  return p.end ? `${p.start} → ${p.end}` : p.start;
}

export function dateCellRange(value: unknown): DayRange | null {
  const p = parseDateCell(value);
  if (!p) return null;
  return { start: p.start, end: p.end ?? p.start };
}

export function localDay(time: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(time);
      const y = parts.find((p) => p.type === "year")?.value;
      const m = parts.find((p) => p.type === "month")?.value;
      const d = parts.find((p) => p.type === "day")?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // Fallback to local runtime date
    }
  }
  const y = time.getFullYear();
  const m = String(time.getMonth() + 1).padStart(2, "0");
  const d = String(time.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((ta - tb) / 86_400_000);
}

export function resolveRelativeDate(token: string, today: string, weekStart: 0 | 1 = 1): DayRange | null {
  const key = token.startsWith("@") ? token.slice(1) : token;
  if (!isValidDay(today)) return null;
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const startOfWeekOffset = (dow - weekStart + 7) % 7;

  const monthRange = (year: number, monthIndex: number): DayRange => {
    const first = new Date(Date.UTC(year, monthIndex, 1));
    const last = new Date(Date.UTC(year, monthIndex + 1, 0));
    const fmt = (x: Date) =>
      `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
    return { start: fmt(first), end: fmt(last) };
  };

  switch (key as RelativeDateToken) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const x = addDays(today, -1);
      return { start: x, end: x };
    }
    case "tomorrow": {
      const x = addDays(today, 1);
      return { start: x, end: x };
    }
    case "this_week": {
      const s = addDays(today, -startOfWeekOffset);
      return { start: s, end: addDays(s, 6) };
    }
    case "last_week": {
      const s = addDays(today, -startOfWeekOffset - 7);
      return { start: s, end: addDays(s, 6) };
    }
    case "next_week": {
      const s = addDays(today, -startOfWeekOffset + 7);
      return { start: s, end: addDays(s, 6) };
    }
    case "this_month":
      return monthRange(y, m - 1);
    case "last_month":
      return monthRange(y, m - 2);
    case "next_month":
      return monthRange(y, m);
    case "last_7_days":
      return { start: addDays(today, -6), end: today };
    case "last_30_days":
      return { start: addDays(today, -29), end: today };
    case "next_7_days":
      return { start: today, end: addDays(today, 6) };
    case "next_30_days":
      return { start: today, end: addDays(today, 29) };
    default:
      return null;
  }
}

export function rangesOverlap(a: DayRange, b: DayRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}
