import Link from "next/link";
import { endOfDay, endOfWeek, format, isSameDay, startOfDay } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ArrowRight, Bell, CalendarDays, ClipboardCheck, Pin, Send } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { parseSteps } from "@/lib/services/approval";
import { formatRelative } from "@/lib/format";
import { approvalTabWhere } from "@/lib/oa/server";
import { CATEGORY_COLOR } from "@/lib/oa/types";
import { Card, Page, PageHeader, Section, StatCard, TopBar } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

function MoreLink({ href, children = "查看全部" }: { href: string; children?: string }) {
  return (
    <Link href={href} className="flex items-center gap-0.5 text-xs text-ink-2 hover:text-ink">
      {children}
      <ArrowRight className="size-3" />
    </Link>
  );
}

export default async function OaHomePage() {
  const user = await requireUser();
  const now = new Date();
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const mineEvents = { OR: [{ organizerId: user.id }, { attendees: { some: { userId: user.id } } }] };

  const [todo, todoCount, mine, mineCount, flows, announcements, unreadAnn, events] = await Promise.all([
    db.approvalInstance.findMany({
      where: approvalTabWhere("todo", user.id),
      include: { flow: { select: { icon: true, name: true } }, applicant: { select: { name: true, avatarColor: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    db.approvalInstance.count({ where: approvalTabWhere("todo", user.id) }),
    db.approvalInstance.findMany({
      where: { applicantId: user.id, status: "PENDING" },
      include: { flow: { select: { icon: true, name: true } }, tasks: { where: { status: "PENDING" }, include: { approver: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    db.approvalInstance.count({ where: { applicantId: user.id, status: "PENDING" } }),
    db.approvalFlow.findMany({ where: { system: false, enabled: true }, orderBy: { createdAt: "asc" }, take: 8 }),
    db.announcement.findMany({
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      include: { author: { select: { name: true } }, reads: { where: { userId: user.id }, select: { id: true } } },
      take: 5,
    }),
    db.announcement.count({ where: { reads: { none: { userId: user.id } } } }),
    db.calendarEvent.findMany({
      where: { AND: [mineEvents, { endAt: { gte: startOfDay(now) } }, { startAt: { lte: weekEnd } }] },
      orderBy: { startAt: "asc" },
      take: 10,
    }),
  ]);
  const todayEvents = events.filter((e) => e.startAt <= endOfDay(now));

  return (
    <>
      <TopBar
        crumbs={[{ label: "OA 办公" }, { label: "工作台" }]}
        actions={
          <LinkButton href="/oa/approvals/new" variant="primary">
            <Send className="size-3.5" />
            发起审批
          </LinkButton>
        }
      />
      <Page wide>
        <PageHeader icon="🗂️" title="OA 工作台" description="审批、公告与日程，一处掌握" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="待我审批" value={todoCount} icon={<ClipboardCheck />} href="/oa/approvals" hint={todoCount ? "请尽快处理" : "全部处理完毕"} />
          <StatCard label="我发起的进行中" value={mineCount} icon={<Send />} href="/oa/approvals?tab=mine&status=PENDING" />
          <StatCard label="未读公告" value={unreadAnn} icon={<Bell />} href="/oa/announcements?status=unread" />
          <StatCard label="今日日程" value={todayEvents.length} icon={<CalendarDays />} href="/oa/calendar" hint={`本周共 ${events.length} 项`} />
        </div>

        <Section title="常用审批" actions={<MoreLink href="/oa/approvals/new">全部流程</MoreLink>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {flows.map((f) => (
              <Link
                key={f.id}
                href={`/oa/approvals/new?flow=${f.key}`}
                className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-sidebar"
              >
                <span className="text-xl">{f.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{f.name}</span>
                  <span className="block truncate text-xs text-ink-3">{parseSteps(f.steps).map((s) => s.name).join(" → ")}</span>
                </span>
              </Link>
            ))}
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          <div>
            <Section title={`待我审批 ${todoCount || ""}`} actions={<MoreLink href="/oa/approvals" />}>
              <Card className="divide-y divide-line">
                {todo.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-ink-3">🎉 没有待处理的审批</div>}
                {todo.map((a) => (
                  <Link key={a.id} href={`/oa/approvals/${a.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-sidebar">
                    <span className="text-lg">{a.flow.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{a.title}</span>
                      <span className="flex items-center gap-1 text-xs text-ink-3">
                        <Avatar name={a.applicant.name} color={a.applicant.avatarColor} size={14} />
                        {a.applicant.name} · {a.flow.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{formatRelative(a.createdAt)}</span>
                  </Link>
                ))}
              </Card>
            </Section>
            <Section title="我发起的进行中" actions={<MoreLink href="/oa/approvals?tab=mine" />}>
              <Card className="divide-y divide-line">
                {mine.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-ink-3">没有进行中的申请</div>}
                {mine.map((a) => (
                  <Link key={a.id} href={`/oa/approvals/${a.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-sidebar">
                    <span className="text-lg">{a.flow.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{a.title}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {a.tasks[0] ? `${a.tasks[0].stepName} · 等待 ${a.tasks.map((t) => t.approver.name).join(" / ")}` : "处理中"}
                      </span>
                    </span>
                    <Badge color="blue">审批中</Badge>
                  </Link>
                ))}
              </Card>
            </Section>
          </div>
          <div>
            <Section title="本周日程" actions={<MoreLink href="/oa/calendar?view=week">打开日历</MoreLink>}>
              <Card className="divide-y divide-line">
                {events.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-ink-3">本周没有日程</div>}
                {events.map((e) => (
                  <Link
                    key={e.id}
                    href={`/oa/calendar?date=${format(e.startAt, "yyyy-MM-dd")}&event=${e.id}`}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-sidebar"
                  >
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="w-16 shrink-0 text-xs text-ink-2">
                      <span className="block font-medium text-ink">{isSameDay(e.startAt, now) ? "今天" : format(e.startAt, "EEE", { locale: zhCN })}</span>
                      {e.allDay ? "全天" : format(e.startAt, "HH:mm")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{e.title}</span>
                      {e.location && <span className="block truncate text-xs text-ink-3">{e.location}</span>}
                    </span>
                  </Link>
                ))}
              </Card>
            </Section>
            <Section title="最新公告" actions={<MoreLink href="/oa/announcements" />}>
              <Card className="divide-y divide-line">
                {announcements.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-ink-3">暂无公告</div>}
                {announcements.map((a) => (
                  <Link key={a.id} href={`/oa/announcements/${a.id}`} className="flex items-center gap-2 px-3 py-2.5 hover:bg-sidebar">
                    <span className="flex w-2 justify-center">{!a.reads.length && <span className="size-1.5 rounded-full bg-accent" />}</span>
                    {a.pinned && <Pin className="size-3 shrink-0 fill-[#d9730d] text-[#d9730d]" />}
                    <span className={a.reads.length ? "min-w-0 flex-1 truncate text-sm text-ink" : "min-w-0 flex-1 truncate text-sm font-medium text-ink"}>{a.title}</span>
                    <Badge color={CATEGORY_COLOR[a.category] ?? "gray"}>{a.category}</Badge>
                    <span className="shrink-0 text-xs text-ink-3">{formatRelative(a.publishedAt)}</span>
                  </Link>
                ))}
              </Card>
            </Section>
          </div>
        </div>
      </Page>
    </>
  );
}
