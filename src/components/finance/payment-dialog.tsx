"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { formatMoney, toDateInput } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/finance/labels";
import { recordInvoicePayment } from "@/app/(app)/finance/actions";

/** 登记收款 / 付款（调用 recordPayment，自动生成凭证） */
export function PaymentDialog({
  invoiceId,
  invoiceNo,
  type,
  remaining,
  variant = "primary",
  size = "sm",
}: {
  invoiceId: string;
  invoiceNo: string;
  type: "RECEIVABLE" | "PAYABLE";
  remaining: number;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const formId = useId();
  const verb = type === "RECEIVABLE" ? "收款" : "付款";
  const init = () => ({ amount: String(remaining), method: PAYMENT_METHODS[0], paidAt: toDateInput(new Date()), memo: "" });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(init);
  const { run, pending } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    run(
      () =>
        recordInvoicePayment({
          invoiceId,
          amount: Number(v.amount),
          method: v.method,
          paidAt: v.paidAt,
          memo: v.memo,
        }),
      { success: `${verb}已登记，已自动生成记账凭证`, onSuccess: () => setOpen(false) },
    );
  }

  const amount = Number(v.amount) || 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(init());
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          登记{verb}
        </Button>
      </DialogTrigger>
      <DialogContent
        size="sm"
        title={`登记${verb}`}
        description={`发票 ${invoiceNo} · 未结金额 ${formatMoney(remaining)}`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" type="submit" form={formId} loading={pending}>
              确认{verb}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} className="space-y-3 pb-2">
          <Field
            label={`${verb}金额（元）`}
            required
            hint={amount > remaining ? <span className="text-danger">不能超过未结金额 {formatMoney(remaining)}</span> : amount < remaining && amount > 0 ? `部分${verb}，剩余 ${formatMoney(remaining - amount)}` : `全额${verb}`}
          >
            <Input type="number" step="0.01" min="0.01" max={remaining} value={v.amount} autoFocus onChange={(e) => setV({ ...v, amount: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="方式" required>
              <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="日期" required>
              <Input type="date" value={v.paidAt} onChange={(e) => setV({ ...v, paidAt: e.target.value })} />
            </Field>
          </div>
          <Field label="备注">
            <Textarea rows={2} value={v.memo} onChange={(e) => setV({ ...v, memo: e.target.value })} placeholder="如银行流水号" />
          </Field>
          <p className="rounded-md bg-sidebar px-3 py-2 text-xs text-ink-2">
            {type === "RECEIVABLE" ? "凭证：借 银行存款，贷 应收账款。收清后销售订单自动完成。" : "凭证：借 应付账款，贷 银行存款。付清后采购单自动结清。"}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
