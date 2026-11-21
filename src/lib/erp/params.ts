export type SearchParams = Record<string, string | string[] | undefined>;

export function str(v: string | string[] | undefined) {
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
}

export function oneOf<T extends string>(v: string, keys: readonly T[]): T | undefined {
  return (keys as readonly string[]).includes(v) ? (v as T) : undefined;
}

export type MonthBucket = { key: string; label: string; start: Date; end: Date };

/** 最近 n 个自然月（含本月），按时间升序 */
export function lastMonths(n = 6, now = new Date()): MonthBucket[] {
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: `${start.getMonth() + 1}月`,
      start,
      end,
    };
  });
}

export function bucketIndex(buckets: MonthBucket[], d: Date) {
  return buckets.findIndex((b) => d >= b.start && d < b.end);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** 解析 yyyy-MM-dd 为本地日期零点；endOfDay 时返回次日零点（用作不含的截止时间） */
export function parseDay(s: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const v = new Date(y, m - 1, d + (endOfDay ? 1 : 0));
  return Number.isNaN(v.getTime()) ? null : v;
}
