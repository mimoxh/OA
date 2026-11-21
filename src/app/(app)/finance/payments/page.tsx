import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney } from "@/lib/format";
import { INVOICE_TYPE } from "@/lib/labels";
import { oneOf, parseDay, round2, str } from "@/lib/erp/params";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, StatCard, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/finance/date-range-filter";

export default async function PaymentsPage({ searchParams }: PageProps<"/finance/payments">) {
  await requireUser();
  const sp = await searchParams;
  const type = oneOf(str(sp.type), ["RECEIVABLE", "PAYABLE"] as const);
  const q = str(sp.q);
  const from = parseDay(str(sp.from));
  const to = parseDay(str(sp.to), true);
  const where: Prisma.PaymentWhereInput = {
    ...(type ? { invoice: { type } } : {}),
    ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { no: { contains: q } },
            { memo: { contains: q } },
            { invoice: { no: { contains: q } } },
            { invoice: { customer: { name: { contains: q } } } },
            { invoice: { supplier: { name: { contains: q } } } },
          ],
        }
      : {}),
  };
  const payments = await db.payment.findMany({
    where,
    include: { invoice: { include: { customer: true, supplier: true } }, createdBy: true },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
  });
  const inflow = round2(payments.filter((p) => p.invoice.type === "RECEIVABLE").reduce((s, p) => s + p.amount, 0));
  const outflow = round2(payments.filter((p) => p.invoice.type === "PAYABLE").reduce((s, p) => s + p.amount, 0));

  return (
    <>
      <TopBar crumbs={[{ label: "财务", href: "/finance" }, { label: "收付款记录" }]} />
      <Page wide>
        <PageHeader icon="💳" title="收付款记录" description="在发票详情中登记收付款，系统自动生成记账凭证" />
        <div className="mb-5 grid grid-cols-3 gap-3">
          <StatCard label="收款合计" value={<span className="text-[#448361]">{formatMoney(inflow)}</span>} hint="当前筛选条件" />
          <StatCard label="付款合计" value={<span className="text-[#d9730d]">{formatMoney(outflow)}</span>} hint="当前筛选条件" />
          <StatCard label="净流入" value={formatMoney(inflow - outflow)} />
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <FilterPills
              param="type"
              options={[
                { value: "RECEIVABLE", label: "收款" },
                { value: "PAYABLE", label: "付款" },
              ]}
            />
            <DateRangeFilter />
          </div>
          <SearchInput placeholder="搜索流水号、发票、往来单位…" />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>流水号</TH>
              <TH>类型</TH>
              <TH>日期</TH>
              <TH>往来单位</TH>
              <TH>发票</TH>
              <TH className="text-right">金额</TH>
              <TH>方式</TH>
              <TH>经办人</TH>
              <TH>备注</TH>
            </TR>
          </THead>
          <TBody>
            {payments.length === 0 && <TEmpty colSpan={9}>没有符合条件的收付款记录</TEmpty>}
            {payments.map((p) => {
              const recv = p.invoice.type === "RECEIVABLE";
              return (
                <TR key={p.id}>
                  <TD className="font-mono text-xs">{p.no}</TD>
                  <TD>
                    <StatusBadge map={{ RECEIVABLE: { ...INVOICE_TYPE.RECEIVABLE, label: "收款" }, PAYABLE: { ...INVOICE_TYPE.PAYABLE, label: "付款" } }} value={p.invoice.type} />
                  </TD>
                  <TD className="text-ink-2">{formatDate(p.paidAt)}</TD>
                  <TD className="max-w-56 truncate">{p.invoice.customer?.name ?? p.invoice.supplier?.name ?? "—"}</TD>
                  <TD>
                    <Link href={`/finance/invoices/${p.invoiceId}`} className="text-accent hover:underline">
                      {p.invoice.no}
                    </Link>
                  </TD>
                  <TD className={`text-right font-medium tabular-nums ${recv ? "text-[#448361]" : "text-[#d9730d]"}`}>
                    {recv ? "+" : "−"}
                    {formatMoney(p.amount)}
                  </TD>
                  <TD className="text-ink-2">{p.method}</TD>
                  <TD>
                    <UserChip name={p.createdBy.name} color={p.createdBy.avatarColor} />
                  </TD>
                  <TD className="max-w-40 truncate text-ink-2">{p.memo ?? "—"}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Page>
    </>
  );
}
