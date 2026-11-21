import { endOfMonth, endOfWeek, format, isValid, parse, startOfMonth, startOfWeek } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { getMemberOptions } from "@/lib/oa/server";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { CalendarView } from "./calendar-view";
import type { CalEvent } from "./event-dialog";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const eventInclude = {
  organizer: { select: { id: true, name: true, avatarColor: true } },
  attendees: { include: { user: { select: { name: true, avatarColor: true } } } },
} satisfies Prisma.CalendarEventInclude;

type Row = Prisma.CalendarEventGetPayload<{ include: typeof eventInclude }>;

function serialize(e: Row): CalEvent {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    allDay: e.allDay,
    color: e.color,
    organizer: e.organizer,
    attendees: e.attendees.map((a) => ({ userId: a.userId, name: a.user.name, avatarColor: a.user.avatarColor, status: a.status })),
  };
}

export default async function CalendarPage({ searchParams }: PageProps<"/oa/calendar">) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = str(sp.view) === "week" ? "week" : "month";
  const parsed = parse(str(sp.date), "yyyy-MM-dd", new Date());
  const anchor = isValid(parsed) ? parsed : new Date();
  const opts = { weekStartsOn: 1 as const };
  const rangeStart = view === "month" ? startOfWeek(startOfMonth(anchor), opts) : startOfWeek(anchor, opts);
  const rangeEnd = view === "month" ? endOfWeek(endOfMonth(anchor), opts) : endOfWeek(anchor, opts);
  const mine: Prisma.CalendarEventWhereInput = { OR: [{ organizerId: user.id }, { attendees: { some: { userId: user.id } } }] };
  const eventId = str(sp.event);

  const [rows, members, pendingCount] = await Promise.all([
    db.calendarEvent.findMany({
      where: { AND: [mine, { startAt: { lte: rangeEnd } }, { endAt: { gte: rangeStart } }] },
      include: eventInclude,
      orderBy: { startAt: "asc" },
    }),
    getMemberOptions(),
    db.eventAttendee.count({ where: { userId: user.id, status: "pending", event: { endAt: { gte: new Date() } } } }),
  ]);
  if (eventId && !rows.some((r) => r.id === eventId)) {
    const extra = await db.calendarEvent.findFirst({ where: { AND: [mine, { id: eventId }] }, include: eventInclude });
    if (extra) rows.push(extra);
  }

  return (
    <>
      <TopBar crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "日程会议" }]} />
      <Page wide>
        <PageHeader
          icon="📅"
          title="日程会议"
          description={pendingCount ? `你有 ${pendingCount} 个日程邀请待回复（斜体显示）` : "我组织和参与的日程，点击日期即可快速新建"}
        />
        <CalendarView
          key={`${view}-${format(anchor, "yyyy-MM-dd")}-${eventId}`}
          view={view}
          anchor={format(anchor, "yyyy-MM-dd")}
          events={rows.map(serialize)}
          members={members}
          meId={user.id}
          openEventId={eventId || undefined}
        />
      </Page>
    </>
  );
}
