import { addDays, endOfWeek, isBefore, startOfDay } from "date-fns";

export const TASK_STATUS_ORDER = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export const TASK_PRIORITY_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;

export const PROJECT_MEMBER_ROLE: Record<string, string> = {
  owner: "负责人",
  member: "成员",
  viewer: "观察者",
};

export const PROJECT_COLORS = ["#2383e2", "#448361", "#d9730d", "#9065b0", "#d44c47", "#cb912f", "#c14c8a", "#337ea9", "#787774"];
export const PROJECT_ICONS = ["🚀", "🛠️", "📦", "🏢", "📱", "🌐", "🎯", "📊", "🧪", "💡", "🔧", "📝"];

export function taskKey(code: string, no: number) {
  return `${code}-${no}`;
}

export function isOverdue(due: Date | string | null | undefined, status: string) {
  if (!due || status === "DONE") return false;
  return isBefore(new Date(due), startOfDay(new Date()));
}

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";
export const DUE_BUCKETS: { key: DueBucket; label: string; icon: string }[] = [
  { key: "overdue", label: "已逾期", icon: "🔥" },
  { key: "today", label: "今天", icon: "📌" },
  { key: "week", label: "本周", icon: "🗓️" },
  { key: "later", label: "以后", icon: "🔭" },
  { key: "none", label: "无截止日期", icon: "🫧" },
];

export function dueBucket(due: Date | null, now = new Date()): DueBucket {
  if (!due) return "none";
  const today = startOfDay(now);
  const d = new Date(due);
  if (isBefore(d, today)) return "overdue";
  if (isBefore(d, addDays(today, 1))) return "today";
  if (!isBefore(endOfWeek(now, { weekStartsOn: 1 }), d)) return "week";
  return "later";
}

/** 看板插入位置：取前后两张卡片 sortOrder 的中值 */
export function between(prev: number | undefined, next: number | undefined) {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return (next as number) - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}
