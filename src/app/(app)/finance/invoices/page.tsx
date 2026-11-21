import Link from "next/link";
import type { InvoiceType, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/labels";
import { oneOf, round2, str } from "@/lib/erp/params";
import { StatusBadge } from "@/components/ui/badge";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { QueryTabs } from "@/components/finance/query-tabs";

export default async function InvoicesPage({ searchParams }: PageProps<"/finance/invoices">) {
  await requireUser();
  const sp = await searchParams;
  const type: InvoiceType = oneOf(str(sp.type), ["RECEIVABLE", "PAYABLE"] as const) ?? "RECEIVABLE";
  const status = str(sp.status);
  const q = str(sp.q);
  const now = new Date();

  const statusWhere: Prisma.InvoiceWhereInput =
    status === "open"
      ? { status: { in: ["UNPAID", "PARTIAL"] } }
      : status === "overdue"
        ? { status: { in: ["UNPAID", "PARTIAL"] }, dueDate: { lt: now } }
        : oneOf(status, ["UNPAID", "PARTIAL", "PAID", "VOID"] as const)
          ? { status: status as "UNPAID" }
          : {};
  const search: Prisma.InvoiceWhereInput = q
    ? {
        OR: [
          { no: { contains: q } },
          { memo: { contains: q } },
          { customer: { name: { contains: q } } },
          { supplier: { name: { contains: q } } },
          { salesOrder: { no: { contains: q } } },
          { purchaseOrder: { no: { contains: q } } },
        ],
      }
    : {};

  const [invoices, typeCounts, sums] = await Promise.all([
    db.invoice.findMany({
      where: { type, ...statusWhere, ...search },
      include: { customer: true, supplier: true, salesOrder: true, purchaseOrder: true },
      orderBy: [{ createdAt: "desc" }],
    }),
    db.invoice.groupBy({ by: ["type"], where: { status: { in: ["UNPAID", "PARTIAL"] } }, _count: { _all: true } }),
    db.invoice.aggregate({
      where: { AND: [{ type, ...statusWhere, ...search }, { status: { not: "VOID" } }] },
      _sum: { amount: true, paidAmount: true },
    }),
  ]);
  const openCount = Object.fromEntries(typeCounts.map((t) => [t.type, t._count._all]));
  const keep = (t: InvoiceType) => {
    const p = new URLSearchParams();
    p.set("type", t);
    if (status) p.set("status", status);
    return `/finance/invoices?${p}`;
  };
  const receivable = type === "RECEIVABLE";
  const total = round2(sums._sum.amount ?? 0);
  const paid = round2(sums._sum.paidAmount ?? 0);

  return (
    <>
      <TopBar crumbs={[{ label: "财务", href: "/finance" }, { label: "应收应付" }]} />
      <Page wide>
        <PageHeader icon="📑" title="应收应付" description="应收由销售签收自动生成，应付由采购入库自动生成" />
        <QueryTabs
          className="mb-4"
          items={[
            { href: keep("RECEIVABLE"), label: "应收账款", count: openCount.RECEIVABLE ?? 0, active: receivable },
            { href: keep("PAYABLE"), label: "应付账款", count: openCount.PAYABLE ?? 0, active: !receivable },
          ]}
        />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FilterPills
            options={[
              { value: "open", label: "未结清" },
              { value: "overdue", label: "已逾期" },
              { value: "PARTIAL", label: "部分结清" },
              { value: "PAID", label: "已结清" },
              { value: "VOID", label: "已作废" },
            ]}
          />
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-ink-2">
              合计 <span className="font-medium text-ink tabular-nums">{formatMoney(total)}</span>
              <span className="mx-2 text-ink-3">·</span>
              {receivable ? "已收" : "已付"} <span className="tabular-nums">{formatMoney(paid)}</span>
              <span className="mx-2 text-ink-3">·</span>
              未结 <span className="font-medium text-ink tabular-nums">{formatMoney(total - paid)}</span>
            </span>
            <SearchInput placeholder="搜索发票号、往来单位、单据…" />
          </div>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>发票号</TH>
              <TH>{receivable ? "客户" : "供应商"}</TH>
              <TH>关联单据</TH>
              <TH className="text-right">金额</TH>
              <TH className="text-right">{receivable ? "已收" : "已付"}</TH>
              <TH className="text-right">未结</TH>
              <TH>到期日</TH>
              <TH>状态</TH>
            </TR>
          </THead>
          <TBody>
            {invoices.length === 0 && <TEmpty colSpan={8}>没有符合条件的发票</TEmpty>}
            {invoices.map((i) => {
              const open = i.status === "UNPAID" || i.status === "PARTIAL";
              const overdue = open && i.dueDate && i.dueDate < now;
              return (
                <TR key={i.id}>
                  <TD>
                    <Link href={`/finance/invoices/${i.id}`} className="font-medium hover:underline">
                      {i.no}
                    </Link>
                    <div className="text-xs text-ink-3">开票 {formatDate(i.createdAt)}</div>
                  </TD>
                  <TD className="max-w-56 truncate">
                    {i.customer ? (
                      <Link href={`/crm/customers/${i.customer.id}`} className="hover:underline">
                        {i.customer.name}
                      </Link>
                    ) : i.supplier ? (
                      <Link href={`/erp/suppliers/${i.supplier.id}`} className="hover:underline">
                        {i.supplier.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD>
                    {i.salesOrder ? (
                      <Link href={`/erp/sales/${i.salesOrder.id}`} className="text-accent hover:underline">
                        {i.salesOrder.no}
                      </Link>
                    ) : i.purchaseOrder ? (
                      <Link href={`/erp/purchase/${i.purchaseOrder.id}`} className="text-accent hover:underline">
                        {i.purchaseOrder.no}
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{formatMoney(i.amount)}</TD>
                  <TD className="text-right tabular-nums text-ink-2">{formatMoney(i.paidAmount)}</TD>
                  <TD className="text-right font-medium tabular-nums">{i.status === "VOID" ? "—" : formatMoney(i.amount - i.paidAmount)}</TD>
                  <TD className={overdue ? "font-medium text-danger" : "text-ink-2"}>
                    {formatDate(i.dueDate)}
                    {overdue && <div className="text-xs">已逾期 {Math.floor((now.getTime() - i.dueDate!.getTime()) / 864e5)} 天</div>}
                  </TD>
                  <TD>
                    <StatusBadge map={INVOICE_STATUS} value={i.status} />
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
