import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { round2 } from "@/lib/erp/params";
import { sourceHref, sourceMeta } from "@/lib/finance/labels";
import { Badge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

async function resolveSource(type: string, id: string | null) {
  if (!id) return null;
  if (type === "payment") {
    const p = await db.payment.findUnique({ where: { id }, include: { invoice: true } });
    return p ? { href: `/finance/invoices/${p.invoiceId}`, label: `${p.no}（发票 ${p.invoice.no}）` } : null;
  }
  const href = sourceHref(type, id);
  if (!href) return null;
  const label = await (async () => {
    switch (type) {
      case "purchase_inbound":
        return (await db.inboundOrder.findUnique({ where: { id } }))?.no;
      case "sales_shipment":
        return (await db.outboundOrder.findUnique({ where: { id } }))?.no;
      case "sales_delivery":
        return (await db.salesOrder.findUnique({ where: { id } }))?.no;
      case "expense":
        return (await db.approvalInstance.findUnique({ where: { id } }))?.no;
      case "freight":
        return (await db.transportOrder.findUnique({ where: { id } }))?.no;
      case "invoice_void":
        return (await db.invoice.findUnique({ where: { id } }))?.no;
    }
  })();
  return { href, label: label ?? "查看单据" };
}

export default async function VoucherDetailPage({ params }: PageProps<"/finance/vouchers/[id]">) {
  const { id } = await params;
  await requireUser();
  const entry = await db.journalEntry.findUnique({
    where: { id },
    include: { lines: { include: { account: true }, orderBy: [{ credit: "asc" }, { id: "asc" }] }, createdBy: true },
  });
  if (!entry) notFound();
  const source = await resolveSource(entry.sourceType, entry.sourceId);
  const m = sourceMeta(entry.sourceType);
  const debit = round2(entry.lines.reduce((s, l) => s + l.debit, 0));
  const credit = round2(entry.lines.reduce((s, l) => s + l.credit, 0));

  return (
    <>
      <TopBar crumbs={[{ label: "财务", href: "/finance" }, { label: "记账凭证", href: "/finance/vouchers" }, { label: entry.no }]} />
      <Page>
        <PageHeader
          icon="📒"
          title={`记账凭证 ${entry.no}`}
          description={entry.memo}
          meta={
            <>
              <Badge color={m.color}>{m.label}</Badge>
              <span className="text-ink-2">日期 {formatDate(entry.date)}</span>
            </>
          }
        />
        <Properties>
          <Property label="凭证日期">{formatDate(entry.date)}</Property>
          <Property label="来源">
            <span className="inline-flex items-center gap-2">
              <Badge color={m.color}>{m.label}</Badge>
              {source && (
                <Link href={source.href} className="inline-flex items-center gap-1 text-accent hover:underline">
                  {source.label}
                  <ExternalLink className="size-3" />
                </Link>
              )}
            </span>
          </Property>
          <Property label="制单人">
            <UserChip name={entry.createdBy.name} color={entry.createdBy.avatarColor} />
          </Property>
          <Property label="制单时间">{formatDateTime(entry.createdAt)}</Property>
        </Properties>

        <Section title="分录">
          <Table>
            <THead>
              <TR>
                <TH>科目编码</TH>
                <TH>科目名称</TH>
                <TH>摘要</TH>
                <TH className="text-right">借方</TH>
                <TH className="text-right">贷方</TH>
              </TR>
            </THead>
            <TBody>
              {entry.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="font-mono text-xs">{l.account.code}</TD>
                  <TD className={l.credit > 0 ? "pl-6" : undefined}>{l.account.name}</TD>
                  <TD className="text-ink-2">{l.memo ?? entry.memo}</TD>
                  <TD className="text-right tabular-nums">{l.debit ? formatMoney(l.debit) : ""}</TD>
                  <TD className="text-right tabular-nums">{l.credit ? formatMoney(l.credit) : ""}</TD>
                </TR>
              ))}
              <TR>
                <TD colSpan={3} className="text-right font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {debit === credit && <CheckCircle2 className="size-4 text-[#448361]" />}
                    合计
                  </span>
                </TD>
                <TD className="text-right font-semibold tabular-nums">{formatMoney(debit)}</TD>
                <TD className="text-right font-semibold tabular-nums">{formatMoney(credit)}</TD>
              </TR>
            </TBody>
          </Table>
        </Section>
      </Page>
    </>
  );
}
