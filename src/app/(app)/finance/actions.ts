"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { audit } from "@/lib/services/notify";
import { ACCOUNT, postJournal } from "@/lib/services/ledger";
import { recordPayment } from "@/lib/services/flows";
import { parseDateInput } from "@/lib/format";
import { parseInput } from "@/lib/erp/validate";
import { round2 } from "@/lib/erp/params";

function refresh() {
  revalidatePath("/finance", "layout");
  revalidatePath("/erp", "layout");
}

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number({ error: "金额必须是数字" }).positive("金额必须大于 0"),
  method: z.string().trim().min(1, "请选择收付款方式").max(20),
  paidAt: z.string().nullish(),
  memo: z
    .string()
    .trim()
    .max(200, "备注不能超过 200 个字")
    .nullish()
    .transform((v) => v || undefined),
});

export async function recordInvoicePayment(input: z.input<typeof paymentSchema>) {
  return runAction("finance:edit", async (user) => {
    const v = parseInput(paymentSchema, input);
    const paidAt = parseDateInput(v.paidAt);
    if (paidAt && paidAt.getTime() > Date.now() + 864e5) throw new Error("收付款日期不能晚于今天");
    const payment = await db.$transaction(async (tx) => {
      const p = await recordPayment(tx, {
        invoiceId: v.invoiceId,
        amount: v.amount,
        method: v.method,
        memo: v.memo,
        paidAt: paidAt ?? undefined,
        userId: user.id,
      });
      // 凭证日期与实际收付款日期保持一致
      if (paidAt) {
        await tx.journalEntry.updateMany({ where: { sourceType: "payment", sourceId: p.id }, data: { date: paidAt } });
      }
      await audit(tx, { entityType: "invoice", entityId: v.invoiceId, action: "payment", detail: `${p.no} ${p.amount}`, userId: user.id });
      return p;
    });
    refresh();
    return { id: payment.id, no: payment.no };
  });
}

export async function voidInvoice(id: string) {
  return runAction("finance:edit", async (user) => {
    await db.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
      if (!inv) throw new Error("发票不存在");
      if (inv.status !== "UNPAID" || inv._count.payments > 0) throw new Error("只有未结清且没有收付款记录的发票可以作废");
      await tx.invoice.update({ where: { id }, data: { status: "VOID" } });
      // 反向冲销原确认凭证：应收（借应收 贷收入）→ 借收入 贷应收；应付（借库存 贷应付）→ 借应付 贷库存
      const receivable = inv.type === "RECEIVABLE";
      await postJournal(tx, {
        memo: `${receivable ? "应收" : "应付"}发票作废冲销 ${inv.no}`,
        sourceType: "invoice_void",
        sourceId: inv.id,
        userId: user.id,
        lines: receivable
          ? [
              { account: ACCOUNT.REVENUE, debit: inv.amount, memo: `冲销 ${inv.no}` },
              { account: ACCOUNT.AR, credit: inv.amount, memo: `冲销 ${inv.no}` },
            ]
          : [
              { account: ACCOUNT.AP, debit: inv.amount, memo: `冲销 ${inv.no}` },
              { account: ACCOUNT.INVENTORY, credit: inv.amount, memo: `冲销 ${inv.no}` },
            ],
      });
      await audit(tx, { entityType: "invoice", entityId: id, action: "void", userId: user.id });
    });
    refresh();
  });
}

const voucherSchema = z.object({
  date: z.string().min(1, "请选择凭证日期"),
  memo: z.string().trim().min(1, "请填写凭证摘要").max(200, "摘要不能超过 200 个字"),
  lines: z
    .array(
      z.object({
        account: z.string().min(1, "请为每条分录选择科目"),
        debit: z.number({ error: "借方金额必须是数字" }).min(0, "金额不能为负数"),
        credit: z.number({ error: "贷方金额必须是数字" }).min(0, "金额不能为负数"),
        memo: z.string().trim().max(200).optional(),
      }),
    )
    .min(2, "凭证至少需要两条分录"),
});

export async function createManualVoucher(input: z.input<typeof voucherSchema>) {
  return runAction("finance:edit", async (user) => {
    const v = parseInput(voucherSchema, input);
    const date = parseDateInput(v.date);
    if (!date) throw new Error("凭证日期不正确");
    for (const [i, l] of v.lines.entries()) {
      if (l.debit > 0 && l.credit > 0) throw new Error(`第 ${i + 1} 行分录不能同时填写借方和贷方`);
      if (!(l.debit > 0) && !(l.credit > 0)) throw new Error(`第 ${i + 1} 行分录请填写借方或贷方金额`);
    }
    const debit = round2(v.lines.reduce((s, l) => s + l.debit, 0));
    const credit = round2(v.lines.reduce((s, l) => s + l.credit, 0));
    if (debit !== credit) throw new Error(`借贷不平衡：借方合计 ${debit}，贷方合计 ${credit}`);
    const entry = await db.$transaction((tx) =>
      postJournal(tx, {
        memo: v.memo,
        date,
        sourceType: "manual",
        userId: user.id,
        lines: v.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, memo: l.memo || undefined })),
      }),
    );
    refresh();
    return { id: entry.id };
  });
}

const accountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, "科目编码为 4-10 位数字"),
  name: z.string().trim().min(1, "请填写科目名称").max(40, "名称不能超过 40 个字"),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], { error: "请选择科目类别" }),
});

export async function createAccount(input: z.input<typeof accountSchema>) {
  return runAction("finance:edit", async () => {
    const v = parseInput(accountSchema, input);
    const dup = await db.account.findUnique({ where: { code: v.code } });
    if (dup) throw new Error(`科目编码 ${v.code} 已被「${dup.name}」使用`);
    const a = await db.account.create({ data: v });
    refresh();
    return { id: a.id };
  });
}

export async function renameAccount(id: string, name: string) {
  return runAction("finance:edit", async () => {
    const n = name.trim();
    if (!n) throw new Error("请填写科目名称");
    if (n.length > 40) throw new Error("名称不能超过 40 个字");
    await db.account.update({ where: { id }, data: { name: n } });
    refresh();
  });
}
