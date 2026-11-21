import Link from "next/link";
import { format, startOfDay, startOfMonth, startOfWeek, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/common";
import { FOLLOWUP_TYPE } from "@/lib/labels";
import { getActiveUsers } from "@/lib/crm/queries";
import { UrlSelect } from "@/components/crm/url-select";
import { FollowUpDialog, FollowUpTimeline } from "@/components/crm/followups";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const RANGES: Record<string, string> = {
  today: "今天",
  week: "本周",
  month: "本月",
  "30d": "近 30 天",
  upcoming: "有待跟进计划",
};

function rangeWhere(range: string, now: Date): Prisma.FollowUpWhereInput {
  switch (range) {
    case "today":
      return { createdAt: { gte: startOfDay(now) } };
    case "week":
      return { createdAt: { gte: startOfWeek(now, { weekStartsOn: 1 }) } };
    case "month":
      return { createdAt: { gte: startOfMonth(now) } };
    case "30d":
      return { createdAt: { gte: subDays(now, 30) } };
    case "upcoming":
      return { nextAt: { gte: now } };
    default:
      return {};
  }
}

export default async function FollowUpsPage({ searchParams }: PageProps<"/crm/followups">) {
  const user = await requireUser();
  const canEdit = can(user, "crm:edit");
  const sp = await searchParams;
  const type = str(sp.type);
  const owner = str(sp.user);
  const range = str(sp.range);
  const q = str(sp.q).trim();
  const now = new Date();

  const where: Prisma.FollowUpWhereInput = {
    ...(type ? { type } : {}),
    ...(owner === "mine" ? { userId: user.id } : owner ? { userId: owner } : {}),
    ...rangeWhere(range, now),
    ...(q ? { OR: [{ content: { contains: q } }, { customer: { name: { contains: q } } }] } : {}),
  };
  const [rows, users, customers, opps] = await Promise.all([
    db.followUp.findMany({
      where,
      orderBy: range === "upcoming" ? { nextAt: "asc" } : { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { name: true, avatarColor: true } },
        customer: { select: { id: true, name: true } },
        opportunity: { select: { id: true, name: true } },
      },
    }),
    getActiveUsers(),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { code: "asc" } }),
    db.opportunity.findMany({ where: { stage: { not: "LOST" } }, select: { id: true, name: true, customerId: true } }),
  ]);

  const groups: { key: string; label: string; items: typeof rows }[] = [];
  for (const r of rows) {
    const d = range === "upcoming" && r.nextAt ? r.nextAt : r.createdAt;
    const key = format(d, "yyyy-MM-dd");
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: format(d, "M月d日 EEEE", { locale: zhCN }), items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }
  const filtered = !!(type || owner || range || q);

  return (
    <>
      <TopBar
        crumbs={[{ label: "CRM 客户", href: "/crm" }, { label: "跟进记录" }]}
        actions={
          canEdit && (
            <FollowUpDialog
              customers={customers}
              opportunities={opps}
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新增跟进
                </Button>
              }
            />
          )
        }
      />
      <Page>
        <PageHeader icon="📞" title="跟进记录" description="所有客户的电话、拜访、邮件、会议与微信沟通记录" />
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <SearchInput placeholder="搜索内容或客户" />
          <UrlSelect param="type" placeholder="全部方式" options={Object.entries(FOLLOWUP_TYPE).map(([k, v]) => ({ value: k, label: v }))} />
          <UrlSelect param="user" placeholder="全部跟进人" options={[{ value: "mine", label: "我的跟进" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
          <UrlSelect param="range" placeholder="全部时间" options={Object.entries(RANGES).map(([k, v]) => ({ value: k, label: v }))} />
          {filtered && (
            <Link href="/crm/followups" className="text-[13px] text-ink-2 hover:text-accent">
              清除筛选
            </Link>
          )}
          <span className="ml-auto text-xs text-ink-3">{rows.length} 条</span>
        </div>
        {groups.length === 0 ? (
          <FollowUpTimeline items={[]} currentUserId={user.id} canEdit={canEdit} empty={filtered ? "没有符合条件的跟进记录" : "还没有跟进记录"} />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key}>
                <h3 className="mb-3 border-b border-line pb-1 text-xs font-medium text-ink-2">
                  {g.label}
                  {range === "upcoming" && " · 计划跟进"}
                </h3>
                <FollowUpTimeline items={g.items} showCustomer currentUserId={user.id} canEdit={canEdit} />
              </section>
            ))}
          </div>
        )}
      </Page>
    </>
  );
}
