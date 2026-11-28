"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInMinutes,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parse,
  setHours,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { MemberOption } from "@/lib/oa/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EventDialog, type CalEvent, type EventDraft } from "./event-dialog";
import { MobileCalendar, type CalendarViewKind, type ParsedEvent } from "./mobile-calendar";

type View = CalendarViewKind;
type Parsed = ParsedEvent;

const HOUR = 48;
const WEEK = { weekStartsOn: 1 as const };
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function tint(hex: string, alpha: string) {
  return `${hex}${alpha}`;
}

export function CalendarView({
  view,
  anchor,
  events,
  members,
  meId,
  openEventId,
}: {
  view: View;
  anchor: string;
  events: CalEvent[];
  members: MemberOption[];
  meId: string;
  openEventId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const anchorDate = useMemo(() => parse(anchor, "yyyy-MM-dd", new Date()), [anchor]);
  const [dialog, setDialog] = useState<{ kind: "new"; draft: EventDraft } | { kind: "event"; id: string } | null>(
    openEventId ? { kind: "event", id: openEventId } : null,
  );
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const parsed = useMemo<Parsed[]>(
    () =>
      events
        .map((e) => {
          const start = new Date(e.startAt);
          const end = new Date(e.endAt);
          return { ...e, start, end, multiDay: !isSameDay(start, end) };
        })
        .sort((a, b) => Number(b.allDay || b.multiDay) - Number(a.allDay || a.multiDay) || a.start.getTime() - b.start.getTime()),
    [events],
  );

  const go = (v: View, d: Date) => router.push(`${pathname}?view=${v}&date=${format(d, "yyyy-MM-dd")}`);
  // 桌面只有月 / 周网格：日视图按周显示，列表按月显示
  const desktopView: "month" | "week" = view === "week" || view === "day" ? "week" : "month";
  const step = (dir: -1 | 1) => go(desktopView, desktopView === "month" ? addMonths(anchorDate, dir) : addWeeks(anchorDate, dir));
  // 手机上切换视图 / 翻页不进浏览历史，返回键直接回上一级
  const goMobile = (v: View, d: Date) => router.replace(`${pathname}?view=${v}&date=${format(d, "yyyy-MM-dd")}`, { scroll: false });
  const stepMobile = (dir: -1 | 1) =>
    goMobile(view, view === "day" ? addDays(anchorDate, dir) : view === "week" ? addWeeks(anchorDate, dir) : addMonths(anchorDate, dir));

  const eventsOn = (day: Date) => parsed.filter((e) => e.start <= endOfDay(day) && e.end >= startOfDay(day));

  const closeDialog = () => {
    setDialog(null);
    if (openEventId) router.replace(`${pathname}?view=${view}&date=${anchor}`, { scroll: false });
  };

  const newAt = (day: Date, hour = 9) => {
    const start = setHours(startOfDay(day), hour);
    setDialog({ kind: "new", draft: { start, end: setHours(startOfDay(day), Math.min(hour + 1, 23)), allDay: false } });
  };

  const weekStart = startOfWeek(anchorDate, WEEK);
  const title =
    desktopView === "month"
      ? format(anchorDate, "yyyy年 M月")
      : `${format(weekStart, "yyyy年 M月d日")} – ${format(addDays(weekStart, 6), isSameMonth(weekStart, addDays(weekStart, 6)) ? "d日" : "M月d日")}`;

  const current = dialog?.kind === "event" ? parsed.find((e) => e.id === dialog.id) : undefined;

  return (
    <div>
      <div className="md:hidden">
        <MobileCalendar
          view={view}
          anchor={anchorDate}
          now={now}
          eventsOn={eventsOn}
          events={parsed}
          meId={meId}
          onNavigate={goMobile}
          onStep={stepMobile}
          onNew={(d, h) => newAt(d, h ?? Math.min(((now ?? d).getHours() || 8) + 1, 22))}
          onOpen={(id) => setDialog({ kind: "event", id })}
        />
      </div>
      <div className="max-md:hidden">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-xl font-semibold text-ink">{title}</h2>
        <div className="flex items-center">
          <Button variant="ghost" size="sm" aria-label="上一页" onClick={() => step(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" onClick={() => go(view, new Date())}>
            今天
          </Button>
          <Button variant="ghost" size="sm" aria-label="下一页" onClick={() => step(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md bg-hover p-0.5 text-[13px]">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => go(v, anchorDate)}
                className={cn("rounded px-3 py-1 transition-colors", desktopView === v ? "bg-white font-medium text-ink shadow-card" : "text-ink-2 hover:text-ink")}
              >
                {v === "month" ? "月" : "周"}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={() => newAt(now ?? anchorDate, Math.min(((now ?? anchorDate).getHours() || 8) + 1, 22))}>
            <Plus className="size-3.5" />
            新建日程
          </Button>
        </div>
      </div>

      {desktopView === "month" ? (
        <MonthGrid
          anchor={anchorDate}
          now={now}
          eventsOn={eventsOn}
          meId={meId}
          onNew={(d) => newAt(d)}
          onOpen={(id) => setDialog({ kind: "event", id })}
          onMore={(d) => go("week", d)}
        />
      ) : (
        <WeekGrid
          weekStart={weekStart}
          now={now}
          eventsOn={eventsOn}
          meId={meId}
          onNew={newAt}
          onOpen={(id) => setDialog({ kind: "event", id })}
        />
      )}
      </div>

      {dialog?.kind === "new" && (
        <EventDialog key="new" draft={dialog.draft} members={members} meId={meId} onClose={closeDialog} />
      )}
      {dialog?.kind === "event" && current && (
        <EventDialog key={current.id} event={current} members={members} meId={meId} onClose={closeDialog} />
      )}
    </div>
  );
}

function isDeclined(e: Parsed, meId: string) {
  return e.attendees.some((a) => a.userId === meId && a.status === "declined");
}

function isPendingForMe(e: Parsed, meId: string) {
  return e.attendees.some((a) => a.userId === meId && a.status === "pending");
}

function MonthGrid({
  anchor,
  now,
  eventsOn,
  meId,
  onNew,
  onOpen,
  onMore,
}: {
  anchor: Date;
  now: Date | null;
  eventsOn: (d: Date) => Parsed[];
  meId: string;
  onNew: (d: Date) => void;
  onOpen: (id: string) => void;
  onMore: (d: Date) => void;
}) {
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(anchor), WEEK), end: endOfWeek(endOfMonth(anchor), WEEK) });
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-7 border-b border-line bg-sidebar">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-right text-xs text-ink-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const list = eventsOn(day);
          const today = now && isSameDay(day, now);
          const inMonth = isSameMonth(day, anchor);
          return (
            <div
              key={day.toISOString()}
              onClick={() => onNew(day)}
              className={cn(
                "group min-h-[116px] cursor-pointer border-line p-1 transition-colors hover:bg-sidebar/70",
                i % 7 !== 6 && "border-r",
                i < days.length - 7 && "border-b",
                !inMonth && "bg-sidebar/50",
              )}
            >
              <div className="mb-0.5 flex items-center justify-between px-1">
                <Plus className="size-3.5 text-ink-3 opacity-0 group-hover:opacity-100" />
                <span
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] tabular-nums",
                    today ? "bg-[#eb5757] font-semibold text-white" : inMonth ? "text-ink" : "text-ink-3",
                  )}
                >
                  {day.getDate() === 1 ? format(day, "M月d日") : day.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((e) => {
                  const bar = e.allDay || e.multiDay;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpen(e.id);
                      }}
                      title={e.title}
                      className={cn(
                        "flex w-full items-center gap-1 truncate rounded px-1.5 py-[2px] text-left text-xs transition-colors",
                        bar ? "font-medium" : "hover:bg-hover",
                        isDeclined(e, meId) && "line-through opacity-50",
                      )}
                      style={bar ? { backgroundColor: tint(e.color, "2e"), color: "#37352f" } : undefined}
                    >
                      {!bar && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />}
                      {!bar && <span className="shrink-0 tabular-nums text-ink-3">{format(e.start, "HH:mm")}</span>}
                      <span className={cn("truncate", isPendingForMe(e, meId) && "italic")}>{e.title}</span>
                    </button>
                  );
                })}
                {list.length > 3 && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onMore(day);
                    }}
                    className="w-full rounded px-1.5 text-left text-xs text-ink-2 hover:bg-hover"
                  >
                    还有 {list.length - 3} 项
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function layoutDay(list: Parsed[]) {
  const lanes: Date[] = [];
  const placed = list.map((e) => {
    let lane = lanes.findIndex((end) => end <= e.start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(e.end);
    } else lanes[lane] = e.end;
    return { e, lane };
  });
  return { placed, lanes: Math.max(1, lanes.length) };
}

function WeekGrid({
  weekStart,
  now,
  eventsOn,
  meId,
  onNew,
  onOpen,
}: {
  weekStart: Date;
  now: Date | null;
  eventsOn: (d: Date) => Parsed[];
  meId: string;
  onNew: (d: Date, hour: number) => void;
  onOpen: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR * 8 - 8;
  }, []);
  const allDayRows = days.map((d) => eventsOn(d).filter((e) => e.allDay || e.multiDay));
  const hasAllDay = allDayRows.some((r) => r.length);

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-line bg-sidebar">
        <div />
        {days.map((d, i) => {
          const today = now && isSameDay(d, now);
          return (
            <div key={i} className="flex items-center justify-center gap-1.5 border-l border-line py-2 text-[13px]">
              <span className="text-ink-2">{WEEKDAYS[i]}</span>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full tabular-nums",
                  today ? "bg-[#eb5757] font-semibold text-white" : "text-ink",
                )}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-line">
          <div className="px-1 py-1.5 text-right text-[11px] text-ink-3">全天</div>
          {allDayRows.map((list, i) => (
            <div key={i} className="space-y-0.5 border-l border-line p-1">
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpen(e.id)}
                  title={e.title}
                  className={cn("block w-full truncate rounded px-1.5 py-[2px] text-left text-xs font-medium text-ink", isDeclined(e, meId) && "line-through opacity-50")}
                  style={{ backgroundColor: tint(e.color, "2e") }}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="h-[620px] overflow-y-auto">
        <div className="relative grid grid-cols-[56px_repeat(7,1fr)]" style={{ height: HOUR * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-3" style={{ top: h * HOUR }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((day, di) => {
            const { placed, lanes } = layoutDay(eventsOn(day).filter((e) => !e.allDay && !e.multiDay));
            const today = now && isSameDay(day, now);
            return (
              <div key={di} className={cn("relative border-l border-line", today && "bg-accent-soft/30")}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    onClick={() => onNew(day, h)}
                    className="cursor-pointer border-b border-line/70 transition-colors hover:bg-hover/60"
                    style={{ height: HOUR }}
                  />
                ))}
                {placed.map(({ e, lane }) => {
                  const top = (differenceInMinutes(e.start, startOfDay(day)) / 60) * HOUR;
                  const height = Math.max(20, (differenceInMinutes(e.end, e.start) / 60) * HOUR - 2);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onOpen(e.id)}
                      className={cn(
                        "absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs leading-tight transition-shadow hover:shadow-pop",
                        isDeclined(e, meId) && "line-through opacity-50",
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        backgroundColor: tint(e.color, "24"),
                        borderLeftColor: e.color,
                      }}
                    >
                      <div className="truncate font-medium text-ink">{e.title}</div>
                      {height > 30 && (
                        <div className="truncate text-[11px] text-ink-2">
                          {format(e.start, "HH:mm")} - {format(e.end, "HH:mm")}
                          {e.location ? ` · ${e.location}` : ""}
                        </div>
                      )}
                    </button>
                  );
                })}
                {today && now && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-[#eb5757]" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }}>
                    <span className="absolute -left-1 -top-1 size-2.5 rounded-full bg-[#eb5757]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
