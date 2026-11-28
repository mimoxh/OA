import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney } from "@/lib/format";
import { parseDay, round2, str } from "@/lib/erp/params";
import { sourceMeta, VOUCHER_SOURCE } from "@/lib/finance/labels";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/finance/date-range-filter";
import { MobileCard, MobileList } from "@/components/mobile/mobile-list";

export default async function VouchersPage({ searchParams }: PageProps<"/finance/vouchers">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = str(sp.q);
  const source = str(sp.source);
  const from = parseDay(str(sp.from));
  const to = parseDay(str(sp.to), true);
  const base: Prisma.JournalEntryWhereInput = {
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
                { no: { contains: q } },
                { memo: { contains: q } },
                { lines: { some: { memo: { contains: q } } } },
            { lines: { some: { account: { OR: [{ name: { contains: q } }, { code: q }] } } } },
          ],
        }
      : {}),
  };
  const [entries, groups] = await Promise.all([
    db.journalEntry.findMany({
      where: { ...base, ...(source ? { sourceType: source } : {}) },
      include: { lines: { include: { account: true } }, createdBy: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
    db.journalEntry.groupBy({ by: ["sourceType"], where: base, _count: { _all: true } }),
  ]);
  const total = round2(entries.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.debit, 0), 0));

  return (
    <>
      <TopBar
        crumbs={[{ label: "财务", href: "/finance" }, { label: "记账凭证" }]}
        actions={
          can(user, "finance:edit") && (
            <LinkButton href="/finance/vouchers/new" variant="primary">
              <Plus className="size-3.5" />
              手工凭证
            </LinkButton>
          )
        }
      />
      <Page wide>
        <PageHeader icon="📒" title="记账凭证" description="业务单据自动生成的凭证与手工录入凭证" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FilterPills
            param="source"
            options={groups
              .sort((a, b) => b._count._all - a._count._all)
              .map((g) => ({ value: g.sourceType, label: (VOUCHER_SOURCE[g.sourceType]?.label ?? g.sourceType), count: g._count._all }))}
          />
          <SearchInput placeholder="搜索凭证号、摘要…" />
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <DateRangeFilter />
          <span className="text-[13px] text-ink-2">
            共 {entries.length} 张，借方合计 <span className="font-medium tabular-nums text-ink">{formatMoney(total)}</span>
          </span>
        </div>
        <MobileList empty="没有符合条件的凭证">
          {entries.map((e) => {
            const m = sourceMeta(e.sourceType);
            const accounts = [...new Set(e.lines.map((l) => l.account.name))];
            return (
              <MobileCard
                key={e.id}
                href={`/finance/vouchers/${e.id}`}
                title={e.memo || e.no}
                badge={<Badge color={m.color}>{m.label}</Badge>}
                subtitle={`${e.no} · ${formatDate(e.date)}`}
                meta={
                  <>
                    <span className="text-ink-3">{accounts.join("、")}</span>
                  </>
                }
                aside={formatMoney(e.lines.reduce((s, l) => s + l.debit, 0))}
              />
            );
          })}
        </MobileList>
        <Table className="max-md:hidden">
          <THead>
            <TR>
              <TH>凭证号</TH>
              <TH>日期</TH>
              <TH>摘要</TH>
              <TH>来源</TH>
              <TH>科目</TH>
              <TH className="text-right">借方合计</TH>
              <TH>制单人</TH>
            </TR>
          </THead>
          <TBody>
            {entries.length === 0 && <TEmpty colSpan={7}>没有符合条件的凭证</TEmpty>}
            {entries.map((e) => {
              const m = sourceMeta(e.sourceType);
              const accounts = [...new Set(e.lines.map((l) => l.account.name))];
              return (
                <TR key={e.id}>
                  <TD>
                    <Link href={`/finance/vouchers/${e.id}`} className="font-medium hover:underline">
                      {e.no}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-2">{formatDate(e.date)}</TD>
                  <TD className="max-w-80 truncate">{e.memo}</TD>
                  <TD>
                    <Badge color={m.color}>{m.label}</Badge>
                  </TD>
                  <TD className="max-w-56 truncate text-xs text-ink-2">{accounts.join("、")}</TD>
                  <TD className="text-right font-medium tabular-nums">{formatMoney(e.lines.reduce((s, l) => s + l.debit, 0))}</TD>
                  <TD>
                    <UserChip name={e.createdBy.name} color={e.createdBy.avatarColor} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Page>
    </>
  );
}
