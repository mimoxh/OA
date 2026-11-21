import Link from "next/link";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/labels";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { PaymentDialog } from "@/components/finance/payment-dialog";
import type { InvoiceStatus, InvoiceType } from "@/generated/prisma/client";

type InvoiceRow = {
  id: string;
  no: string;
  type: InvoiceType;
  amount: number;
  paidAmount: number;
  status: InvoiceStatus;
  dueDate: Date | null;
  createdAt: Date;
  payments: { id: string; no: string; amount: number; method: string; paidAt: Date; memo: string | null; createdBy: { name: string; avatarColor: string } }[];
};

/** 单据详情中的发票与收付款列表 */
export function InvoicePayments({ invoices, canPay, empty }: { invoices: InvoiceRow[]; canPay: boolean; empty: string }) {
  const now = new Date();
  const payments = invoices.flatMap((i) => i.payments.map((p) => ({ ...p, invoiceNo: i.no, invoiceId: i.id })));
  payments.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
  const receivable = invoices[0]?.type !== "PAYABLE";
  return (
    <div className="space-y-4">
      <Table>
        <THead>
          <TR>
            <TH>发票号</TH>
            <TH className="text-right">金额</TH>
            <TH className="text-right">已结</TH>
            <TH className="text-right">未结</TH>
            <TH>到期日</TH>
            <TH>状态</TH>
            {canPay && <TH className="text-right">操作</TH>}
          </TR>
        </THead>
        <TBody>
          {invoices.length === 0 && <TEmpty colSpan={canPay ? 7 : 6}>{empty}</TEmpty>}
          {invoices.map((inv) => {
            const open = inv.status === "UNPAID" || inv.status === "PARTIAL";
            const overdue = open && inv.dueDate && inv.dueDate < now;
            const remaining = Math.round((inv.amount - inv.paidAmount) * 100) / 100;
            return (
              <TR key={inv.id}>
                <TD>
                  <Link href={`/finance/invoices/${inv.id}`} className="font-medium text-accent hover:underline">
                    {inv.no}
                  </Link>
                  <div className="text-xs text-ink-3">开票 {formatDate(inv.createdAt)}</div>
                </TD>
                <TD className="text-right tabular-nums">{formatMoney(inv.amount)}</TD>
                <TD className="text-right tabular-nums text-ink-2">{formatMoney(inv.paidAmount)}</TD>
                <TD className="text-right font-medium tabular-nums">{inv.status === "VOID" ? "—" : formatMoney(remaining)}</TD>
                <TD className={overdue ? "font-medium text-danger" : "text-ink-2"}>
                  {formatDate(inv.dueDate)}
                  {overdue && " · 已逾期"}
                </TD>
                <TD>
                  <StatusBadge map={INVOICE_STATUS} value={inv.status} />
                </TD>
                {canPay && (
                  <TD className="text-right">
                    {open && <PaymentDialog invoiceId={inv.id} invoiceNo={inv.no} type={inv.type} remaining={remaining} size="xs" />}
                  </TD>
                )}
              </TR>
            );
          })}
        </TBody>
      </Table>
      {payments.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">{receivable ? "收款记录" : "付款记录"}</div>
          <Table>
            <THead>
              <TR>
                <TH>流水号</TH>
                <TH>发票</TH>
                <TH className="text-right">金额</TH>
                <TH>方式</TH>
                <TH>日期</TH>
                <TH>经办人</TH>
                <TH>备注</TH>
              </TR>
            </THead>
            <TBody>
              {payments.map((p) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs">{p.no}</TD>
                  <TD>
                    <Link href={`/finance/invoices/${p.invoiceId}`} className="text-accent hover:underline">
                      {p.invoiceNo}
                    </Link>
                  </TD>
                  <TD className="text-right font-medium tabular-nums">{formatMoney(p.amount)}</TD>
                  <TD className="text-ink-2">{p.method}</TD>
                  <TD className="text-ink-2" title={formatDateTime(p.paidAt)}>
                    {formatDate(p.paidAt)}
                  </TD>
                  <TD>
                    <UserChip name={p.createdBy.name} color={p.createdBy.avatarColor} />
                  </TD>
                  <TD className="text-ink-2">{p.memo ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}
