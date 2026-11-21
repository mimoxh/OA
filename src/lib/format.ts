import { format, formatDistanceToNowStrict, isValid } from "date-fns";
import { zhCN } from "date-fns/locale";

type DateLike = Date | string | number | null | undefined;

function toDate(d: DateLike): Date | null {
  if (d === null || d === undefined || d === "") return null;
  const v = d instanceof Date ? d : new Date(d);
  return isValid(v) ? v : null;
}

export function formatMoney(n: number | null | undefined, opts: { symbol?: boolean } = {}) {
  const v = Number(n ?? 0);
  const s = v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.symbol === false ? s : `¥${s}`;
}

export function formatNumber(n: number | null | undefined, digits = 0) {
  return Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function formatDate(d: DateLike, pattern = "yyyy-MM-dd") {
  const v = toDate(d);
  return v ? format(v, pattern, { locale: zhCN }) : "—";
}

export function formatDateTime(d: DateLike) {
  return formatDate(d, "yyyy-MM-dd HH:mm");
}

export function formatRelative(d: DateLike) {
  const v = toDate(d);
  if (!v) return "—";
  if (Math.abs(Date.now() - v.getTime()) < 60_000) return "刚刚";
  return formatDistanceToNowStrict(v, { addSuffix: true, locale: zhCN });
}

/** 供 <input type="date"> 使用 */
export function toDateInput(d: DateLike) {
  const v = toDate(d);
  return v ? format(v, "yyyy-MM-dd") : "";
}

/** 供 <input type="datetime-local"> 使用 */
export function toDateTimeInput(d: DateLike) {
  const v = toDate(d);
  return v ? format(v, "yyyy-MM-dd'T'HH:mm") : "";
}

/** 解析表单中的日期字符串，空值返回 null */
export function parseDateInput(s: FormDataEntryValue | string | null | undefined): Date | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const v = new Date(s);
  return isValid(v) ? v : null;
}
