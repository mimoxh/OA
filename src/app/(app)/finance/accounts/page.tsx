import Link from "next/link";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { can, requireUser } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/format";
import { ACCOUNT_TYPE } from "@/lib/labels";
import { parseDay, str } from "@/lib/erp/params";
import { accountBalances, balanceSide } from "@/lib/finance/balances";
import { StatusBadge } from "@/components/ui/badge";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AccountDialog } from "@/components/finance/account-dialog";
import { DateRangeFilter } from "@/components/finance/date-range-filter";

function Amount({ v }: { v: number }) {
  return <>{v ? formatMoney(v, { symbol: false }) : <span className="text-ink-3">—</span>}</>;
}

export default async function AccountsPage({ searchParams }: PageProps<"/finance/accounts">) {
  const user = await requireUser();
  const sp = await searchParams;
  const fromStr = str(sp.from);
  const toStr = str(sp.to);
  const from = parseDay(fromStr);
  const to = parseDay(toStr, true);
  const { rows, totals } = await accountBalances({ from, to });
  const periodOk = totals.debit === totals.credit;
  const closingOk = totals.closingDebit === totals.closingCredit;
  const rangeLabel = fromStr || toStr ? `${fromStr || "期初"} 至 ${toStr || "今"}` : "全部期间";

  return (
    <>
      <TopBar crumbs={[{ label: "财务", href: "/finance" }, { label: "科目余额" }]} actions={can(user, "finance:edit") && <AccountDialog />} />
      <Page wide>
        <PageHeader icon="⚖️" title="科目余额表" description={`试算平衡 · ${rangeLabel}`} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <DateRangeFilter />
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${periodOk ? "bg-tag-green text-tag-green-ink" : "bg-tag-red text-tag-red-ink"}`}
            >
              {periodOk ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
              本期发生额{periodOk ? "平衡" : `不平衡（差 ${formatMoney(Math.abs(totals.debit - totals.credit))}）`}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${closingOk ? "bg-tag-green text-tag-green-ink" : "bg-tag-red text-tag-red-ink"}`}
            >
              {closingOk ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
              期末余额{closingOk ? "平衡" : `不平衡（差 ${formatMoney(Math.abs(totals.closingDebit - totals.closingCredit))}）`}
            </span>
          </div>
        </div>
        <Table>
          <THead>
            <TR>
              <TH rowSpan={2}>科目编码</TH>
              <TH rowSpan={2}>科目名称</TH>
              <TH rowSpan={2}>类别</TH>
              <TH colSpan={2} className="border-l border-line text-center">
                期初余额
              </TH>
              <TH colSpan={2} className="border-l border-line text-center">
                本期发生额
              </TH>
              <TH colSpan={2} className="border-l border-line text-center">
                期末余额
              </TH>
            </TR>
            <TR>
              <TH className="border-l border-line text-right">借方</TH>
              <TH className="text-right">贷方</TH>
              <TH className="border-l border-line text-right">借方</TH>
              <TH className="text-right">贷方</TH>
              <TH className="border-l border-line text-right">借方</TH>
              <TH className="text-right">贷方</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const o = balanceSide(r.opening, r.type);
              const c = balanceSide(r.closing, r.type);
              const idle = !r.opening && !r.debit && !r.credit && !r.closing;
              return (
                <TR key={r.id} className={idle ? "text-ink-3" : undefined}>
                  <TD className="font-mono text-xs">{r.code}</TD>
                  <TD>
                    <Link href={`/finance/vouchers?q=${encodeURIComponent(r.name)}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={ACCOUNT_TYPE} value={r.type} />
                  </TD>
                  <TD className="border-l border-line text-right tabular-nums">
                    <Amount v={o.side === "借" ? o.amount : 0} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    <Amount v={o.side === "贷" ? o.amount : 0} />
                  </TD>
                  <TD className="border-l border-line text-right tabular-nums">
                    <Amount v={r.debit} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    <Amount v={r.credit} />
                  </TD>
                  <TD className="border-l border-line text-right font-medium tabular-nums">
                    <Amount v={c.side === "借" ? c.amount : 0} />
                  </TD>
                  <TD className="text-right font-medium tabular-nums">
                    <Amount v={c.side === "贷" ? c.amount : 0} />
                  </TD>
                </TR>
              );
            })}
            <TR className="bg-sidebar font-semibold">
              <TD colSpan={3}>合计</TD>
              <TD className="border-l border-line text-right tabular-nums">{formatMoney(totals.openingDebit, { symbol: false })}</TD>
              <TD className="text-right tabular-nums">{formatMoney(totals.openingCredit, { symbol: false })}</TD>
              <TD className={`border-l border-line text-right tabular-nums ${periodOk ? "" : "text-danger"}`}>
                {formatMoney(totals.debit, { symbol: false })}
              </TD>
              <TD className={`text-right tabular-nums ${periodOk ? "" : "text-danger"}`}>{formatMoney(totals.credit, { symbol: false })}</TD>
              <TD className={`border-l border-line text-right tabular-nums ${closingOk ? "" : "text-danger"}`}>
                {formatMoney(totals.closingDebit, { symbol: false })}
              </TD>
              <TD className={`text-right tabular-nums ${closingOk ? "" : "text-danger"}`}>{formatMoney(totals.closingCredit, { symbol: false })}</TD>
            </TR>
          </TBody>
        </Table>
        <p className="mt-3 text-xs text-ink-3">
          说明：资产、费用类科目余额通常在借方，负债、权益、收入类通常在贷方。点击科目名称可查看相关凭证。
        </p>
      </Page>
    </>
  );
}
