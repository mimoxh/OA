import Link from "next/link";
import { AlarmClock, ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney } from "@/lib/format";
import { INVOICE_TYPE } from "@/lib/labels";
import { ACCOUNT } from "@/lib/services/ledger";
import { bucketIndex, lastMonths, round2 } from "@/lib/erp/params";
import { accountSignedBalance } from "@/lib/finance/balances";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, Page, PageHeader, Section, StatCard, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { TrendChart } from "@/components/erp/trend-chart";

export default async function FinanceOverviewPage() {
  const user = await requireUser();
  const months = lastMonths(6);
  const now = new Date();
  const [bank, open, lines, overdue, recent] = await Promise.all([
    accountSignedBalance(ACCOUNT.BANK),
    db.invoice.groupBy({
      by: ["type"],
      where: { status: { in: ["UNPAID", "PARTIAL"] } },
      _sum: { amount: true, paidAmount: true },
      _count: { _all: true },
    }),
    db.journalLine.findMany({
      where: { entry: { date: { gte: months[0].start } }, account: { type: { in: ["REVENUE", "EXPENSE"] } } },
      select: { debit: true, credit: true, account: { select: { code: true, type: true } }, entry: { select: { date: true } } },
    }),
    db.invoice.findMany({
      where: { status: { in: ["UNPAID", "PARTIAL"] }, dueDate: { lt: now } },
      include: { customer: true, supplier: true },
      orderBy: { dueDate: "asc" },
    }),
    db.journalEntry.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 6, include: { lines: true } }),
  ]);
  const openBy = Object.fromEntries(open.map((o) => [o.type, { amount: round2((o._sum.amount ?? 0) - (o._sum.paidAmount ?? 0)), count: o._count._all }]));

  const trend = months.map((m) => ({ label: m.label, revenue: 0, cost: 0, expense: 0 }));
  for (const l of lines) {
    const i = bucketIndex(months, l.entry.date);
    if (i < 0) continue;
    if (l.account.type === "REVENUE") trend[i].revenue += l.credit - l.debit;
    else if (l.account.code === ACCOUNT.COGS) trend[i].cost += l.debit - l.credit;
    else trend[i].expense += l.debit - l.credit;
  }
  trend.forEach((t) => {
    t.revenue = round2(t.revenue);
    t.cost = round2(t.cost);
    t.expense = round2(t.expense);
  });
  const cur = trend[trend.length - 1];
  const gross = round2(cur.revenue - cur.cost);
  const net = round2(gross - cur.expense);
  const overdueTotal = round2(overdue.reduce((s, i) => s + i.amount - i.paidAmount, 0));

  return (
    <>
      <TopBar
        crumbs={[{ label: "财务", href: "/finance" }, { label: "财务概览" }]}
        actions={
          can(user, "finance:edit") && (
            <LinkButton href="/finance/vouchers/new" variant="primary">
              手工凭证
            </LinkButton>
          )
        }
      />
      <Page wide>
        <PageHeader icon="💰" title="财务概览" description="资金、往来与本月损益一览，数据实时来自记账凭证与发票" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="银行存款余额" icon={<Landmark />} value={formatMoney(bank)} hint="科目 1002 借方余额" href="/finance/accounts" />
          <StatCard
            label="应收未收"
            icon={<ArrowDownLeft />}
            value={formatMoney(openBy.RECEIVABLE?.amount ?? 0)}
            hint={`${openBy.RECEIVABLE?.count ?? 0} 张未结清应收发票`}
            href="/finance/invoices?type=RECEIVABLE&status=open"
          />
          <StatCard
            label="应付未付"
            icon={<ArrowUpRight />}
            value={formatMoney(openBy.PAYABLE?.amount ?? 0)}
            hint={`${openBy.PAYABLE?.count ?? 0} 张未结清应付发票`}
            href="/finance/invoices?type=PAYABLE&status=open"
          />
          <StatCard
            label="逾期未结"
            icon={<AlarmClock />}
            value={<span className={overdue.length ? "text-danger" : undefined}>{formatMoney(overdueTotal)}</span>}
            hint={`${overdue.length} 张发票已过到期日`}
            href="/finance/invoices?status=overdue"
          />
        </div>

        <Section title={`本月损益（${months[months.length - 1].label}）`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="收入" value={formatMoney(cur.revenue)} />
            <StatCard label="营业成本" value={formatMoney(cur.cost)} />
            <StatCard label="毛利" value={formatMoney(gross)} hint={cur.revenue > 0 ? `毛利率 ${Math.round((gross / cur.revenue) * 1000) / 10}%` : undefined} />
            <StatCard label="期间费用" value={formatMoney(cur.expense)} hint="销售费用 + 管理费用等" />
            <StatCard label="利润" value={<span className={net < 0 ? "text-danger" : undefined}>{formatMoney(net)}</span>} />
          </div>
        </Section>

        <Section title="近 6 个月收入与费用趋势">
          <Card className="p-4">
            <TrendChart
              data={trend}
              series={[
                { key: "revenue", name: "收入", color: "#448361" },
                { key: "cost", name: "营业成本", color: "#9065b0" },
                { key: "expense", name: "期间费用", color: "#e8a250" },
              ]}
            />
          </Card>
        </Section>

        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          <Section title="逾期发票提醒" actions={<LinkButton href="/finance/invoices?status=overdue" variant="ghost" size="xs">全部</LinkButton>}>
            <Table>
              <THead>
                <TR>
                  <TH>发票</TH>
                  <TH>往来单位</TH>
                  <TH className="text-right">未结</TH>
                  <TH>到期日</TH>
                </TR>
              </THead>
              <TBody>
                {overdue.length === 0 && <TEmpty colSpan={4}>没有逾期发票 🎉</TEmpty>}
                {overdue.slice(0, 8).map((i) => {
                  const days = Math.floor((now.getTime() - i.dueDate!.getTime()) / 864e5);
                  return (
                    <TR key={i.id}>
                      <TD>
                        <Link href={`/finance/invoices/${i.id}`} className="font-medium hover:underline">
                          {i.no}
                        </Link>
                        <div>
                          <StatusBadge map={INVOICE_TYPE} value={i.type} />
                        </div>
                      </TD>
                      <TD className="max-w-48 truncate">{i.customer?.name ?? i.supplier?.name ?? "—"}</TD>
                      <TD className="text-right font-medium tabular-nums">{formatMoney(i.amount - i.paidAmount)}</TD>
                      <TD className="text-danger">
                        {formatDate(i.dueDate)}
                        <div className="text-xs">逾期 {days} 天</div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Section>
          <Section title="最近凭证" actions={<LinkButton href="/finance/vouchers" variant="ghost" size="xs">全部</LinkButton>}>
            <Table>
              <TBody>
                {recent.length === 0 && <TEmpty colSpan={3}>暂无凭证</TEmpty>}
                {recent.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Link href={`/finance/vouchers/${e.id}`} className="font-medium hover:underline">
                        {e.no}
                      </Link>
                      <div className="max-w-72 truncate text-xs text-ink-3">{e.memo}</div>
                    </TD>
                    <TD className="text-ink-2">{formatDate(e.date)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(e.lines.reduce((s, l) => s + l.debit, 0))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </div>
      </Page>
    </>
  );
}
