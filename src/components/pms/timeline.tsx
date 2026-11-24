import Link from "next/link";
import { addDays, differenceInCalendarDays, eachWeekOfInterval, endOfWeek, format, startOfDay, startOfWeek } from "date-fns";
import { Avatar } from "@/components/ui/avatar";
import { TASK_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { isOverdue } from "@/lib/pms/utils";
import { cn } from "@/lib/utils";

const DAY = 22;
const LEFT = 260;
const BAR_COLOR: Record<string, string> = { TODO: "#a5a29c", IN_PROGRESS: "#337ea9", REVIEW: "#9065b0", DONE: "#448361" };

export type TimelineTask = {
  id: string;
  title: string;
  status: keyof typeof TASK_STATUS;
  startDate: Date | null;
  dueDate: Date | null;
  assignee: { name: string; avatarColor: string } | null;
};

export function Timeline({
  tasks,
  milestones,
  projectStart,
  projectEnd,
  taskHref,
}: {
  tasks: TimelineTask[];
  milestones: { id: string; name: string; dueDate: Date | null; status: "OPEN" | "DONE" }[];
  projectStart: Date | null;
  projectEnd: Date | null;
  taskHref: (id: string) => string;
}) {
  const today = startOfDay(new Date());
  const scheduled = tasks
    .filter((t) => t.startDate || t.dueDate)
    .sort((a, b) => +(a.startDate ?? a.dueDate!) - +(b.startDate ?? b.dueDate!));
  const unscheduled = tasks.filter((t) => !t.startDate && !t.dueDate);
  const all = [
    ...scheduled.flatMap((t) => [t.startDate, t.dueDate]),
    ...milestones.map((m) => m.dueDate),
    projectStart,
    projectEnd,
    today,
  ].filter((d): d is Date => !!d);
  const min = new Date(Math.min(...all.map((d) => +d)));
  const max = new Date(Math.max(...all.map((d) => +d)));
  const start = startOfWeek(min, { weekStartsOn: 1 });
  const end = endOfWeek(addDays(max, 3), { weekStartsOn: 1 });
  const days = differenceInCalendarDays(end, start) + 1;
  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
  const x = (d: Date) => differenceInCalendarDays(startOfDay(d), start) * DAY;
  const width = days * DAY;
  const grid = {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${DAY * 7 - 1}px, #e9e9e7 ${DAY * 7 - 1}px, #e9e9e7 ${DAY * 7}px)`,
  };
  const dated = milestones.filter((m) => m.dueDate);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink-2">
        {Object.entries(TASK_STATUS).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="h-2 w-4 rounded-sm" style={{ backgroundColor: BAR_COLOR[k] }} />
            {v.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rotate-45 bg-[#d9730d]" />
          里程碑
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-px bg-danger" />
          今天
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <div className="relative" style={{ width: LEFT + width }}>
          <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-danger/70" style={{ left: LEFT + x(today) + DAY / 2 }} />

          <div className="sticky top-0 z-20 flex h-10 border-b border-line bg-white">
            <div className="sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-white px-3 text-xs font-medium text-ink-2" style={{ width: LEFT }}>
              任务（{scheduled.length}）
            </div>
            <div className="relative" style={{ width }}>
              {weeks.map((w) => (
                <div key={+w} className="absolute top-0 flex h-10 flex-col justify-center border-l border-line pl-1.5 text-[11px] leading-tight" style={{ left: x(w), width: DAY * 7 }}>
                  <span className="text-ink-3">{format(w, "yyyy年M月")}</span>
                  <span className="text-ink-2">
                    {format(w, "M/d")} - {format(addDays(w, 6), "M/d")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex h-9 border-b border-line bg-sidebar/60">
            <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-sidebar px-3 text-xs font-medium text-ink-2" style={{ width: LEFT }}>
              ◆ 里程碑
            </div>
            <div className="relative" style={{ width, ...grid }}>
              {dated.map((m) => (
                <div key={m.id} className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5" style={{ left: x(m.dueDate!) + DAY / 2 - 6 }} title={`${m.name} · ${formatDate(m.dueDate)}`}>
                  <span className={cn("size-3 shrink-0 rotate-45 rounded-[2px]", m.status === "DONE" ? "bg-[#448361]" : "bg-[#d9730d]")} />
                  <span className="whitespace-nowrap text-[11px] text-ink-2">{m.name}</span>
                </div>
              ))}
            </div>
          </div>

          {scheduled.map((t) => {
            const s = t.startDate ?? t.dueDate!;
            const e = t.dueDate ?? t.startDate!;
            const left = x(s);
            const w = Math.max(1, differenceInCalendarDays(startOfDay(e), startOfDay(s)) + 1) * DAY;
            const overdue = isOverdue(t.dueDate, t.status);
            return (
              <div key={t.id} className="group flex h-9 border-b border-line last:border-b-0 hover:bg-sidebar/60">
                <Link
                  href={taskHref(t.id)}
                  scroll={false}
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-white px-3 text-[13px] group-hover:bg-sidebar"
                  style={{ width: LEFT }}
                >
                  <span className={cn("truncate", t.status === "DONE" && "text-ink-2 line-through")}>{t.title}</span>
                </Link>
                <div className="relative" style={{ width, ...grid }}>
                  <Link
                    href={taskHref(t.id)}
                    scroll={false}
                    title={`${t.title}\n${formatDate(t.startDate)} → ${formatDate(t.dueDate)}`}
                    className={cn(
                      "absolute top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 overflow-hidden rounded px-1.5 text-[11px] text-white shadow-card transition-opacity hover:opacity-85",
                      overdue && "ring-2 ring-danger/60",
                    )}
                    style={{ left: left + 2, width: w - 4, backgroundColor: BAR_COLOR[t.status] }}
                  >
                    {t.assignee && <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={14} className="ring-1 ring-white/70" />}
                    {w > 90 && <span className="truncate">{t.title}</span>}
                  </Link>
                  {w <= 90 && (
                    <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-ink-2" style={{ left: left + w + 4 }}>
                      {t.title}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {scheduled.length === 0 && <div className="py-10 text-center text-sm text-ink-3">还没有设置了日期的任务</div>}
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-ink-2">未排期（{unscheduled.length}）</div>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map((t) => (
              <Link key={t.id} href={taskHref(t.id)} scroll={false} className="rounded border border-line px-2 py-0.5 text-[13px] text-ink-2 hover:bg-hover hover:text-ink">
                {t.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
