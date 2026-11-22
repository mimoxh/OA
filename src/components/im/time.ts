import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { zhCN } from "date-fns/locale";

/** 会话列表时间：今天 HH:mm / 昨天 / 今年 M月d日 / yyyy/M/d */
export function convTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "昨天";
  if (isThisYear(d)) return format(d, "M月d日", { locale: zhCN });
  return format(d, "yyyy/M/d");
}

/** 消息流日期分隔条：今天 / 昨天 / M月d日 / yyyy年M月d日 */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "今天";
  if (isYesterday(d)) return "昨天";
  if (isThisYear(d)) return format(d, "M月d日", { locale: zhCN });
  return format(d, "yyyy年M月d日", { locale: zhCN });
}

export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db2 = new Date(b);
  return da.getFullYear() === db2.getFullYear() && da.getMonth() === db2.getMonth() && da.getDate() === db2.getDate();
}
