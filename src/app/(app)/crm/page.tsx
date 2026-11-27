import Link from "next/link";
import { startOfMonth, startOfQuarter } from "date-fns";
import { BellRing, Plus, Target, TrendingUp, Trophy, Users } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader, Section, StatCard, Card } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/ui/avatar";
import { Dot } from "@/components/ui/badge";
import { OPPORTUNITY_STAGE } from "@/lib/labels";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { getActiveUsers } from "@/lib/crm/queries";
import { FollowUpDialog, FollowUpTimeline } from "@/components/crm/followups";
import { cn } from "@/lib/utils";
import { MobileCard, MobileField, MobileList } from "@/components/mobile/mobile-list";
import { ModuleEntries } from "@/components/mobile/module-entries";

const FUNNEL = ["QUALIFY", "NEEDS", "PROPOSAL", "NEGOTIATION", "WON"] as const;
const FUNNEL_COLORS = ["#9b9a97", "#337ea9", "#9065b0", "#d9730d", "#448361"];

export default async function CrmOverviewPage() {
  const user = await requireUser();
  const canEdit = can(user, "crm:edit");
  const now = new Date();
  const [customerCount, newThisMonth, opps, recent, upcoming, users, customers, customersByOwner] = await Promise.all([
    db.customer.count(),
    db.customer.count({ where: { createdAt: { gte: startOfMonth(now) } } }),
    db.opportunity.findMany({ select: { id: true, stage: true, amount: true, probability: true, ownerId: true, updatedAt: true, customerId: true, name: true } }),
    db.followUp.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { name: true, avatarColor: true } }, customer: { select: { id: true, name: true } }, opportunity: { select: { id: true, name: true } } },
    }),
    db.followUp.findMany({
      where: { nextAt: { gte: new Date(now.getTime() - 3 * 864e5) } },
      orderBy: { nextAt: "asc" },
      take: 10,
      include: { user: { select: { name: true, avatarColor: true } }, customer: { select: { id: true, name: true } } },
    }),
    getActiveUsers(),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { code: "asc" } }),
    db.customer.groupBy({ by: ["ownerId"], _count: { _all: true } }),
  ]);

  const open = opps.filter((o) => o.stage !== "WON" && o.stage !== "LOST");
  const openAmount = open.reduce((s, o) => s + o.amount, 0);
  const weighted = open.reduce((s, o) => s + (o.amount * o.probability) / 100, 0);
  const qStart = startOfQuarter(now);
  const wonQuarter = opps.filter((o) => o.stage === "WON" && o.updatedAt >= qStart);
  const wonCount = opps.filter((o) => o.stage === "WON").length;
  const lostCount = opps.filter((o) => o.stage === "LOST").length;
  const winRate = wonCount + lostCount ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

  const funnel = FUNNEL.map((s) => {
    const list = opps.filter((o) => o.stage === s);
    return { stage: s, count: list.length, amount: list.reduce((a, o) => a + o.amount, 0) };
  });
  const maxAmount = Math.max(1, ...funnel.map((f) => f.amount));

  const ownerIds = [...new Set(opps.map((o) => o.ownerId).filter((x): x is string => !!x))];
  const perf = users
    .filter((u) => ownerIds.includes(u.id) || customersByOwner.some((c) => c.ownerId === u.id))
    .map((u) => {
      const mine = opps.filter((o) => o.ownerId === u.id);
      const won = mine.filter((o) => o.stage === "WON");
      const lost = mine.filter((o) => o.stage === "LOST");
      const active = mine.filter((o) => o.stage !== "WON" && o.stage !== "LOST");
      return {
        user: u,
        customers: customersByOwner.find((c) => c.ownerId === u.id)?._count._all ?? 0,
        activeCount: active.length,
        activeAmount: active.reduce((s, o) => s + o.amount, 0),
        wonAmount: won.reduce((s, o) => s + o.amount, 0),
        winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      };
    })
    .sort((a, b) => b.wonAmount + b.activeAmount - (a.wonAmount + a.activeAmount));
  const maxPerf = Math.max(1, ...perf.map((p) => p.wonAmount + p.activeAmount));

  const oppOptions = opps.filter((o) => o.stage !== "LOST").map((o) => ({ id: o.id, name: o.name, customerId: o.customerId }));

  return (
    <>
      <TopBar
        mobileTitle="CRM 客户"
        crumbs={[{ label: "CRM 客户", href: "/crm" }, { label: "销售概览" }]}
        actions={
          canEdit && (
            <FollowUpDialog
              customers={customers}
              opportunities={oppOptions}
              trigger={
                <Button size="sm">
                  <Plus className="size-3.5" />
                  新增跟进
                </Button>
              }
            />
          )
        }
      />
      <Page wide>
        <PageHeader icon="📈" title="销售概览" description="客户、商机与跟进的整体情况" />
        <ModuleEntries moduleKey="crm" permissions={user.permissions} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="客户总数" value={customerCount} hint="全部客户与线索" icon={<Users />} href="/crm/customers" />
          <StatCard label="本月新增客户" value={newThisMonth} hint="本月创建的客户" icon={<Plus />} href="/crm/customers" />
          <StatCard label="进行中商机金额" value={formatMoney(openAmount)} hint={`${open.length} 个商机 · 加权 ${formatMoney(weighted)}`} icon={<Target />} href="/crm/opportunities" />
          <StatCard label="本季度赢单金额" value={formatMoney(wonQuarter.reduce((s, o) => s + o.amount, 0))} hint={`${wonQuarter.length} 个赢单`} icon={<Trophy />} />
          <StatCard label="赢率" value={`${winRate}%`} hint={`赢单 ${wonCount} · 输单 ${lostCount}`} icon={<TrendingUp />} />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Section title="销售漏斗" className="mt-0" actions={<Link href="/crm/opportunities" className="text-xs text-ink-2 hover:text-accent">查看看板 →</Link>}>
            <Card className="p-4">
              <div className="space-y-2.5">
                {funnel.map((f, i) => (
                  <Link key={f.stage} href="/crm/opportunities" className="group grid grid-cols-[72px_1fr] items-center gap-3 max-md:grid-cols-[80px_1fr_auto] max-md:gap-2">
                    <span className="flex items-center gap-1.5 text-[13px] text-ink-2 max-md:whitespace-nowrap">
                      <Dot color={OPPORTUNITY_STAGE[f.stage].color} />
                      {OPPORTUNITY_STAGE[f.stage].label}
                    </span>
                    <div className="flex items-center justify-center">
                      <div
                        className="flex h-8 min-w-[30%] items-center justify-between rounded px-3 text-xs text-white transition-opacity group-hover:opacity-90 max-md:h-5 max-md:min-w-[8%] max-md:[&>span]:hidden"
                        style={{ width: `${Math.max(30, (f.amount / maxAmount) * 100 * (1 - i * 0.04))}%`, backgroundColor: FUNNEL_COLORS[i] }}
                      >
                        <span>{f.count} 个</span>
                        <span className="font-medium tabular-nums">{formatMoney(f.amount)}</span>
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-right text-xs tabular-nums text-ink-2 md:hidden">
                      {f.count} 个 · <span className="font-medium text-ink">{formatMoney(f.amount)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          </Section>

          <Section title="待跟进" className="mt-0" actions={<Link href="/crm/followups" className="text-xs text-ink-2 hover:text-accent">全部跟进 →</Link>}>
            <Card className="divide-y divide-line">
              {upcoming.length === 0 && <div className="py-10 text-center text-sm text-ink-3">没有待跟进事项</div>}
              {upcoming.map((f) => {
                const overdue = f.nextAt! < now;
                return (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2">
                    <BellRing className={cn("size-4 shrink-0", overdue ? "text-danger" : "text-[#d9730d]")} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/crm/customers/${f.customer.id}?tab=followups`} className="truncate text-sm font-medium hover:text-accent">
                        {f.customer.name}
                      </Link>
                      <div className="truncate text-xs text-ink-2">{f.content}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={cn("tabular-nums", overdue ? "text-danger" : "text-ink")}>{formatDateTime(f.nextAt)}</div>
                      <div className="text-ink-3">{overdue ? "已过期" : formatRelative(f.nextAt)} · {f.user.name}</div>
                    </div>
                  </div>
                );
              })}
            </Card>
          </Section>
        </div>

        <Section title="销售业绩">
          <MobileList empty="暂无数据">
            {perf.map((p) => (
              <MobileCard
                key={p.user.id}
                title={<UserChip name={p.user.name} color={p.user.avatarColor} />}
                badge={<span className="text-[13px] text-ink-2">赢率 {p.winRate === null ? "—" : `${p.winRate}%`}</span>}
                meta={
                  <>
                    <MobileField label="客户">{p.customers}</MobileField>
                    <MobileField label="进行中">
                      {p.activeCount} 个 · {formatMoney(p.activeAmount)}
                    </MobileField>
                  </>
                }
                aside={<span className="text-[#448361]">{formatMoney(p.wonAmount)}</span>}
              >
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-hover">
                  <span className="bg-[#448361]" style={{ width: `${(p.wonAmount / maxPerf) * 100}%` }} />
                  <span className="bg-accent/60" style={{ width: `${(p.activeAmount / maxPerf) * 100}%` }} />
                </div>
              </MobileCard>
            ))}
          </MobileList>
          <Table className="max-md:hidden">
            <THead>
              <TR>
                <TH>负责人</TH>
                <TH className="text-right">客户数</TH>
                <TH className="text-right">进行中商机</TH>
                <TH className="text-right">进行中金额</TH>
                <TH className="text-right">赢单金额</TH>
                <TH className="text-right">赢率</TH>
                <TH className="w-[28%]">业绩构成</TH>
              </TR>
            </THead>
            <TBody>
              {perf.length === 0 && <TEmpty colSpan={7} />}
              {perf.map((p) => (
                <TR key={p.user.id}>
                  <TD>
                    <UserChip name={p.user.name} color={p.user.avatarColor} />
                  </TD>
                  <TD className="text-right tabular-nums">{p.customers}</TD>
                  <TD className="text-right tabular-nums">{p.activeCount}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(p.activeAmount)}</TD>
                  <TD className="text-right font-medium tabular-nums">{formatMoney(p.wonAmount)}</TD>
                  <TD className="text-right tabular-nums">{p.winRate === null ? "—" : `${p.winRate}%`}</TD>
                  <TD>
                    <div className="flex h-2 overflow-hidden rounded-full bg-hover" title={`赢单 ${formatMoney(p.wonAmount)} / 进行中 ${formatMoney(p.activeAmount)}`}>
                      <span className="bg-[#448361]" style={{ width: `${(p.wonAmount / maxPerf) * 100}%` }} />
                      <span className="bg-accent/60" style={{ width: `${(p.activeAmount / maxPerf) * 100}%` }} />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="mt-2 flex items-center gap-4 text-xs text-ink-3 max-md:px-1">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-[#448361]" />
              赢单
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-accent/60" />
              进行中
            </span>
          </div>
        </Section>

        <Section title="近期跟进" actions={<Link href="/crm/followups" className="text-xs text-ink-2 hover:text-accent">查看全部 →</Link>}>
          <FollowUpTimeline items={recent} showCustomer currentUserId={user.id} canEdit={canEdit} />
        </Section>
      </Page>
    </>
  );
}
