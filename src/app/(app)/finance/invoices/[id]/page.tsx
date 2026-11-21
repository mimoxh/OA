import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { INVOICE_STATUS, INVOICE_TYPE } from "@/lib/labels";
import { round2 } from "@/lib/erp/params";
import { sourceMeta } from "@/lib/finance/labels";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/erp/action-button";
import { PaymentDialog } from "@/components/finance/payment-dialog";
import { voidInvoice } from "@/app/(app)/finance/actions";

export default async function InvoiceDetailPage({ params }: PageProps<"/finance/invoices/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "finance:edit");
  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      supplier: true,
      salesOrder: true,
      purchaseOrder: { include: { inboundOrders: { select: { id: true, no: true } } } },
      payments: { include: { createdBy: true }, orderBy: { paidAt: "desc" } },
    },
  });
  if (!inv) notFound();

  const receivable = inv.type === "RECEIVABLE";
  const verb = receivable ? "收款" : "付款";
  const remaining = round2(inv.amount - inv.paidAmount);
  const open = inv.status === "UNPAID" || inv.status === "PARTIAL";
  const now = new Date();
  const overdue = open && inv.dueDate && inv.dueDate < now;
  const inboundIds = (inv.purchaseOrder?.inboundOrders ?? []).filter((i) => inv.memo?.includes(i.no)).map((i) => i.id);
  const sources = [
    { sourceType: "payment", sourceId: { in: inv.payments.map((p) => p.id) } },
    { sourceType: "invoice_void", sourceId: inv.id },
    ...(receivable && inv.salesOrderId ? [{ sourceType: "sales_delivery", sourceId: inv.salesOrderId }] : []),
    ...(!receivable && inboundIds.length ? [{ sourceType: "purchase_inbound", sourceId: { in: inboundIds } }] : []),
  ];
  const vouchers = await db.journalEntry.findMany({
    where: { OR: sources },
    include: { lines: true, createdBy: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const partner = inv.customer
    ? { name: inv.customer.name, href: `/crm/customers/${inv.customer.id}` }
    : inv.supplier
      ? { name: inv.supplier.name, href: `/erp/suppliers/${inv.supplier.id}` }
      : null;
  const pct = inv.amount > 0 ? Math.min(100, (inv.paidAmount / inv.amount) * 100) : 0;

  return (
    <>
      <TopBar
        crumbs={[
          { label: "财务", href: "/finance" },
          { label: "应收应付", href: `/finance/invoices?type=${inv.type}` },
          { label: inv.no },
        ]}
        actions={
          canEdit && (
            <>
              {inv.status === "UNPAID" && inv.payments.length === 0 && (
                <ActionButton
                  action={voidInvoice.bind(null, inv.id)}
                  success="发票已作废，已生成冲销凭证"
                  danger
                  confirmText="作废"
                  confirm={{
                    title: `作废发票 ${inv.no}？`,
                    description: receivable
                      ? `将生成冲销凭证：借 主营业务收入 ${formatMoney(inv.amount)}，贷 应收账款 ${formatMoney(inv.amount)}。作废后不可恢复。`
                      : `将生成冲销凭证：借 应付账款 ${formatMoney(inv.amount)}，贷 库存商品 ${formatMoney(inv.amount)}。作废后不可恢复。`,
                  }}
                >
                  作废
                </ActionButton>
              )}
              {open && <PaymentDialog invoiceId={inv.id} invoiceNo={inv.no} type={inv.type} remaining={remaining} />}
            </>
          )
        }
      />
      <Page>
        <PageHeader
          icon={receivable ? "📥" : "📤"}
          title={inv.no}
          description={partner ? <Link href={partner.href} className="hover:underline">{partner.name}</Link> : undefined}
          meta={
            <>
              <StatusBadge map={INVOICE_TYPE} value={inv.type} />
              <StatusBadge map={INVOICE_STATUS} value={inv.status} />
              {overdue && <Badge color="red">已逾期 {Math.floor((now.getTime() - inv.dueDate!.getTime()) / 864e5)} 天</Badge>}
            </>
          }
        />
        <div className="mb-4 grid grid-cols-3 gap-3">
          {[
            ["发票金额", inv.amount, ""],
            [receivable ? "已收金额" : "已付金额", inv.paidAmount, "text-[#448361]"],
            ["未结金额", inv.status === "VOID" ? 0 : remaining, remaining > 0 && inv.status !== "VOID" ? "text-[#d9730d]" : ""],
          ].map(([label, v, cls]) => (
            <div key={label as string} className="rounded-lg border border-line p-4">
              <div className="text-[13px] text-ink-2">{label}</div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${cls}`}>{formatMoney(v as number)}</div>
            </div>
          ))}
        </div>
        <div className="h-1.5 rounded-full bg-hover">
          <div className="h-1.5 rounded-full bg-[#448361]" style={{ width: `${pct}%` }} />
        </div>

        <Properties>
          <Property label={receivable ? "客户" : "供应商"}>
            {partner ? (
              <Link href={partner.href} className="text-accent hover:underline">
                {partner.name}
              </Link>
            ) : (
              "—"
            )}
          </Property>
          <Property label="关联单据">
            {inv.salesOrder ? (
              <Link href={`/erp/sales/${inv.salesOrder.id}`} className="text-accent hover:underline">
                销售订单 {inv.salesOrder.no}
              </Link>
            ) : inv.purchaseOrder ? (
              <Link href={`/erp/purchase/${inv.purchaseOrder.id}`} className="text-accent hover:underline">
                采购订单 {inv.purchaseOrder.no}
              </Link>
            ) : (
              "—"
            )}
          </Property>
          <Property label="开票日期">{formatDateTime(inv.createdAt)}</Property>
          <Property label="到期日">
            <span className={overdue ? "font-medium text-danger" : undefined}>{formatDate(inv.dueDate)}</span>
          </Property>
          <Property label="说明">{inv.memo ?? "—"}</Property>
        </Properties>

        <Section title={`${verb}记录 · ${inv.payments.length}`}>
          <Table>
            <THead>
              <TR>
                <TH>流水号</TH>
                <TH className="text-right">金额</TH>
                <TH>方式</TH>
                <TH>{verb}日期</TH>
                <TH>经办人</TH>
                <TH>备注</TH>
              </TR>
            </THead>
            <TBody>
              {inv.payments.length === 0 && <TEmpty colSpan={6}>暂无{verb}记录</TEmpty>}
              {inv.payments.map((p) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs">{p.no}</TD>
                  <TD className="text-right font-medium tabular-nums">{formatMoney(p.amount)}</TD>
                  <TD>{p.method}</TD>
                  <TD className="text-ink-2">{formatDate(p.paidAt)}</TD>
                  <TD>
                    <UserChip name={p.createdBy.name} color={p.createdBy.avatarColor} />
                  </TD>
                  <TD className="text-ink-2">{p.memo ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section title="相关凭证">
          <Table>
            <THead>
              <TR>
                <TH>凭证号</TH>
                <TH>日期</TH>
                <TH>来源</TH>
                <TH>摘要</TH>
                <TH className="text-right">金额</TH>
                <TH>制单人</TH>
              </TR>
            </THead>
            <TBody>
              {vouchers.length === 0 && <TEmpty colSpan={6}>暂无凭证</TEmpty>}
              {vouchers.map((v) => {
                const m = sourceMeta(v.sourceType);
                return (
                  <TR key={v.id}>
                    <TD>
                      <Link href={`/finance/vouchers/${v.id}`} className="font-medium text-accent hover:underline">
                        {v.no}
                      </Link>
                    </TD>
                    <TD className="text-ink-2">{formatDate(v.date)}</TD>
                    <TD>
                      <Badge color={m.color}>{m.label}</Badge>
                    </TD>
                    <TD className="max-w-72 truncate">{v.memo}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(v.lines.reduce((s, l) => s + l.debit, 0))}</TD>
                    <TD>
                      <UserChip name={v.createdBy.name} color={v.createdBy.avatarColor} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>
      </Page>
    </>
  );
}
