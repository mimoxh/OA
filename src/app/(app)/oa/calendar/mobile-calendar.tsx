"use client";

import { useEffect, useRef, useState } from "react";
import {
  addDays,
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronLeft, ChevronRight, MapPin, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalEvent } from "./event-dialog";

export type CalendarViewKind = "month" | "week" | "day" | "list";
export type ParsedEvent = CalEvent & { start: Date; end: Date; multiDay: boolean };

const WEEK = { weekStartsOn: 1 as const };
const HOUR = 52;
const SHORT_WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const VIEWS: { value: CalendarViewKind; label: string }[] = [
  { value: "month", label: "月" },
  { value: "week", label: "周" },
  { value: "day", label: "日" },
  { value: "list", label: "列表" },
];

const dayTitle = (d: Date) => format(d, "M月d日 EEEE", { locale: zhCN });

function timeText(e: ParsedEvent, day: Date) {
  if (e.allDay) return "全天";
  if (e.multiDay) {
    const s = isSameDay(e.start, day) ? format(e.start, "HH:mm") : "00:00";
    const t = isSameDay(e.end, day) ? format(e.end, "HH:mm") : "24:00";
    return `${s} - ${t}`;
  }
  return `${format(e.start, "HH:mm")} - ${format(e.end, "HH:mm")}`;
}

/**
 * 手机日历：月（紧凑月历 + 当天列表）/ 周（不换行的 7 天条 + 按天列表）/ 日（时间轴）/ 列表（本月有日程的日期）。
 * 桌面端的月 / 周网格在手机上放不下（7 列每列不到 60px，标题会逐字换行），所以手机单独排版。
 */
export function MobileCalendar({
  view,
  anchor,
  now,
  eventsOn,
  events,
  meId,
  onNavigate,
  onStep,
  onNew,
  onOpen,
}: {
  view: CalendarViewKind;
  anchor: Date;
  now: Date | null;
  eventsOn: (d: Date) => ParsedEvent[];
  events: ParsedEvent[];
  meId: string;
  onNavigate: (v: CalendarViewKind, d: Date) => void;
  onStep: (dir: -1 | 1) => void;
  onNew: (d: Date, hour?: number) => void;
  onOpen: (id: string) => void;
}) {
  const [selected, setSelected] = useState(anchor);
  const weekStart = startOfWeek(anchor, WEEK);
  const weekEnd = addDays(weekStart, 6);

  const title =
    view === "day"
      ? format(anchor, "yyyy年M月d日")
      : view === "week"
        ? `${format(weekStart, "M月d日")} – ${format(weekEnd, isSameMonth(weekStart, weekEnd) ? "d日" : "M月d日")}`
        : format(anchor, "yyyy年M月");

  return (
    <div className="pb-[calc(var(--sab)+16px)]" data-mobile-calendar>
      <div className="mb-2 flex items-center gap-1">
        <h2 className="mr-auto truncate text-lg font-semibold text-ink">{title}</h2>
        <button type="button" aria-label="上一页" onClick={() => onStep(-1)} className="rounded-md p-2 text-ink-2 active:bg-hover">
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate(view, new Date())}
          className="h-8 rounded-md border border-line px-3 text-[13px] text-ink active:bg-hover"
        >
          今天
        </button>
        <button type="button" aria-label="下一页" onClick={() => onStep(1)} className="rounded-md p-2 text-ink-2 active:bg-hover">
          <ChevronRight className="size-5" />
        </button>
        <button
          type="button"
          aria-label="新建日程"
          onClick={() => onNew(view === "day" ? anchor : selected)}
          className="ml-1 flex size-8 items-center justify-center rounded-full bg-accent text-white active:opacity-80"
        >
          <Plus className="size-4.5" />
        </button>
      </div>

      <div className="mb-3 grid grid-cols-4 rounded-lg bg-hover p-0.5 text-[14px]">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => onNavigate(v.value, view === "month" || view === "week" ? selected : anchor)}
            className={cn("h-8 rounded-md", view === v.value ? "bg-white font-medium text-ink shadow-card" : "text-ink-2")}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "month" && (
        <>
          <MonthCompact
            anchor={anchor}
            selected={selected}
            now={now}
            eventsOn={eventsOn}
            onSelect={(d) => (isSameMonth(d, anchor) ? setSelected(d) : onNavigate("month", d))}
          />
          <DayAgenda day={selected} list={eventsOn(selected)} meId={meId} onNew={() => onNew(selected)} onOpen={onOpen} />
        </>
      )}
      {view === "week" && (
        <WeekAgenda
          weekStart={weekStart}
          selected={selected}
          now={now}
          eventsOn={eventsOn}
          meId={meId}
          onSelect={setSelected}
          onNew={onNew}
          onOpen={onOpen}
        />
      )}
      {view === "day" && (
        <DayTimeline
          day={anchor}
          now={now}
          eventsOn={eventsOn}
          meId={meId}
          onSelectDay={(d) => onNavigate("day", d)}
          onNew={onNew}
          onOpen={onOpen}
        />
      )}
      {view === "list" && <MonthList anchor={anchor} events={events} eventsOn={eventsOn} meId={meId} onOpen={onOpen} />}
    </div>
  );
}

function Dots({ list }: { list: ParsedEvent[] }) {
  return (
    <span className="flex h-1.5 items-center justify-center gap-0.5">
      {list.slice(0, 3).map((e) => (
        <span key={e.id} className="size-1.5 rounded-full" style={{ backgroundColor: e.color }} />
      ))}
    </span>
  );
}

function MonthCompact({
  anchor,
  selected,
  now,
  eventsOn,
  onSelect,
}: {
  anchor: Date;
  selected: Date;
  now: Date | null;
  eventsOn: (d: Date) => ParsedEvent[];
  onSelect: (d: Date) => void;
}) {
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(anchor), WEEK), end: endOfWeek(endOfMonth(anchor), WEEK) });
  return (
    <div className="rounded-lg border border-line bg-white px-1 pb-1">
      <div className="grid grid-cols-7 py-1.5 text-center text-xs text-ink-3">
        {SHORT_WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const sel = isSameDay(day, selected);
          const today = now && isSameDay(day, now);
          const inMonth = isSameMonth(day, anchor);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={sel}
              className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-md active:bg-hover"
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-[15px] tabular-nums",
                  sel ? "bg-accent font-semibold text-white" : today ? "font-semibold text-[#eb5757]" : inMonth ? "text-ink" : "text-ink-3",
                )}
              >
                {day.getDate()}
              </span>
              <Dots list={eventsOn(day)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventRow({ e, day, meId, onOpen }: { e: ParsedEvent; day: Date; meId: string; onOpen: (id: string) => void }) {
  const declined = e.attendees.some((a) => a.userId === meId && a.status === "declined");
  const pending = e.attendees.some((a) => a.userId === meId && a.status === "pending");
  return (
    <button
      type="button"
      onClick={() => onOpen(e.id)}
      className={cn("flex w-full items-stretch gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-left active:bg-hover", declined && "opacity-50")}
    >
      <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] font-medium text-ink", declined && "line-through", pending && "italic")}>{e.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-2">
          <span className="shrink-0 tabular-nums">{timeText(e, day)}</span>
          {e.location && (
            <span className="flex min-w-0 items-center gap-0.5 truncate">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{e.location}</span>
            </span>
          )}
        </span>
      </span>
      {pending && <span className="self-center text-xs text-[#d9730d]">待回复</span>}
    </button>
  );
}

function DayAgenda({
  day,
  list,
  meId,
  onNew,
  onOpen,
}: {
  day: Date;
  list: ParsedEvent[];
  meId: string;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-ink">{dayTitle(day)}</h3>
        <button type="button" onClick={onNew} className="flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-accent active:bg-hover">
          <Plus className="size-3.5" />
          新建
        </button>
      </div>
      {list.length ? (
        <div className="space-y-2">
          {list.map((e) => (
            <EventRow key={e.id} e={e} day={day} meId={meId} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line py-6 text-center text-[13px] text-ink-3">当天没有日程</p>
      )}
    </section>
  );
}

function WeekStrip({
  weekStart,
  selected,
  now,
  eventsOn,
  onSelect,
}: {
  weekStart: Date;
  selected: Date;
  now: Date | null;
  eventsOn: (d: Date) => ParsedEvent[];
  onSelect: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="grid grid-cols-7 rounded-lg border border-line bg-white p-1">
      {days.map((d, i) => {
        const sel = isSameDay(d, selected);
        const today = now && isSameDay(d, now);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={sel}
            className="flex flex-col items-center gap-0.5 rounded-md py-1 active:bg-hover"
          >
            <span className="text-xs text-ink-3">{SHORT_WEEKDAYS[i]}</span>
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full text-[15px] tabular-nums",
                sel ? "bg-accent font-semibold text-white" : today ? "font-semibold text-[#eb5757]" : "text-ink",
              )}
            >
              {d.getDate()}
            </span>
            <Dots list={eventsOn(d)} />
          </button>
        );
      })}
    </div>
  );
}

function WeekAgenda({
  weekStart,
  selected,
  now,
  eventsOn,
  meId,
  onSelect,
  onNew,
  onOpen,
}: {
  weekStart: Date;
  selected: Date;
  now: Date | null;
  eventsOn: (d: Date) => ParsedEvent[];
  meId: string;
  onSelect: (d: Date) => void;
  onNew: (d: Date) => void;
  onOpen: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const refs = useRef<(HTMLElement | null)[]>([]);
  const pick = (d: Date) => {
    onSelect(d);
    refs.current[days.findIndex((x) => isSameDay(x, d))]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <>
      <div className="sticky top-[calc(var(--sat)+2.75rem)] z-10 -mx-1 bg-white px-1 pb-2">
        <WeekStrip weekStart={weekStart} selected={selected} now={now} eventsOn={eventsOn} onSelect={pick} />
      </div>
      <div className="space-y-4">
        {days.map((d, i) => {
          const list = eventsOn(d);
          const today = now && isSameDay(d, now);
          return (
            <section key={i} ref={(el) => void (refs.current[i] = el)} className="scroll-mt-[calc(var(--sat)+9.5rem)]">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className={cn("text-[14px] font-semibold", today ? "text-[#eb5757]" : "text-ink")}>
                  {dayTitle(d)}
                  {today && <span className="ml-1.5 text-xs font-normal">今天</span>}
                </h3>
                <button type="button" aria-label="在这天新建日程" onClick={() => onNew(d)} className="rounded-md p-1 text-ink-3 active:bg-hover">
                  <Plus className="size-4" />
                </button>
              </div>
              {list.length ? (
                <div className="space-y-2">
                  {list.map((e) => (
                    <EventRow key={e.id} e={e} day={d} meId={meId} onOpen={onOpen} />
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-ink-3">没有日程</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function layoutDay(list: ParsedEvent[]) {
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

function DayTimeline({
  day,
  now,
  eventsOn,
  meId,
  onSelectDay,
  onNew,
  onOpen,
}: {
  day: Date;
  now: Date | null;
  eventsOn: (d: Date) => ParsedEvent[];
  meId: string;
  onSelectDay: (d: Date) => void;
  onNew: (d: Date, hour: number) => void;
  onOpen: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const list = eventsOn(day);
  const allDay = list.filter((e) => e.allDay || e.multiDay);
  const timed = list.filter((e) => !e.allDay && !e.multiDay);
  const { placed, lanes } = layoutDay(timed);
  const today = now && isSameDay(day, now);

  useEffect(() => {
    const first = timed[0]?.start.getHours();
    const h = first ?? (today && now ? now.getHours() : 8);
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, h - 1) * HOUR;
    // 只在切换日期时定位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.getTime()]);

  return (
    <>
      <WeekStrip weekStart={startOfWeek(day, WEEK)} selected={day} now={now} eventsOn={eventsOn} onSelect={onSelectDay} />
      {allDay.length > 0 && (
        <div className="mt-2 space-y-1">
          {allDay.map((e) => (
            <EventRow key={e.id} e={e} day={day} meId={meId} onOpen={onOpen} />
          ))}
        </div>
      )}
      <div ref={scrollRef} className="mt-2 h-[62dvh] overflow-y-auto rounded-lg border border-line bg-white">
        <div className="relative grid grid-cols-[48px_1fr]" style={{ height: HOUR * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-3" style={{ top: h * HOUR }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          <div className="relative border-l border-line">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} onClick={() => onNew(day, h)} className="border-b border-line/70 active:bg-hover/60" style={{ height: HOUR }} />
            ))}
            {placed.map(({ e, lane }) => {
              const top = (differenceInMinutes(e.start, startOfDay(day)) / 60) * HOUR;
              const height = Math.max(24, (differenceInMinutes(e.end, e.start) / 60) * HOUR - 2);
              const declined = e.attendees.some((a) => a.userId === meId && a.status === "declined");
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpen(e.id)}
                  className={cn("absolute overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-[13px] leading-tight", declined && "line-through opacity-50")}
                  style={{
                    top,
                    height,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                    backgroundColor: `${e.color}24`,
                    borderLeftColor: e.color,
                  }}
                >
                  <div className="truncate font-medium text-ink">{e.title}</div>
                  {height > 34 && (
                    <div className="truncate text-xs text-ink-2">
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
        </div>
      </div>
    </>
  );
}

function MonthList({
  anchor,
  events,
  eventsOn,
  meId,
  onOpen,
}: {
  anchor: Date;
  events: ParsedEvent[];
  eventsOn: (d: Date) => ParsedEvent[];
  meId: string;
  onOpen: (id: string) => void;
}) {
  const days = eachDayOfInterval({ start: startOfMonth(anchor), end: endOfMonth(anchor) }).filter((d) => eventsOn(d).length);
  if (!events.length || !days.length)
    return <p className="rounded-lg border border-dashed border-line py-10 text-center text-[13px] text-ink-3">本月没有日程</p>;
  return (
    <div className="space-y-4">
      {days.map((d) => (
        <section key={d.toISOString()}>
          <h3 className="mb-1.5 text-[14px] font-semibold text-ink">{dayTitle(d)}</h3>
          <div className="space-y-2">
            {eventsOn(d).map((e) => (
              <EventRow key={e.id} e={e} day={d} meId={meId} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
