import { db } from "@/lib/db";
import type { AccountType } from "@/generated/prisma/client";
import { isDebitNormal } from "@/lib/finance/labels";
import { round2 } from "@/lib/erp/params";

export type AccountBalanceRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  /** 期初余额（借 - 贷） */
  opening: number;
  debit: number;
  credit: number;
  /** 期末余额（借 - 贷） */
  closing: number;
};

/** 科目期初、本期发生额与期末余额。to 为不含的截止时间。 */
export async function accountBalances(range: { from?: Date | null; to?: Date | null } = {}) {
  const dateFilter = {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lt: range.to } : {}),
  };
  const [accounts, opening, period] = await Promise.all([
    db.account.findMany({ orderBy: { code: "asc" } }),
    range.from
      ? db.journalLine.groupBy({
          by: ["accountId"],
          where: { entry: { date: { lt: range.from } } },
          _sum: { debit: true, credit: true },
        })
      : Promise.resolve([]),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { date: dateFilter } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const openMap = new Map(opening.map((o) => [o.accountId, (o._sum.debit ?? 0) - (o._sum.credit ?? 0)]));
  const periodMap = new Map(period.map((p) => [p.accountId, p._sum]));
  const rows: AccountBalanceRow[] = accounts.map((a) => {
    const o = round2(openMap.get(a.id) ?? 0);
    const p = periodMap.get(a.id);
    const debit = round2(p?.debit ?? 0);
    const credit = round2(p?.credit ?? 0);
    return { id: a.id, code: a.code, name: a.name, type: a.type, opening: o, debit, credit, closing: round2(o + debit - credit) };
  });
  const totals = rows.reduce(
    (t, r) => {
      t.debit += r.debit;
      t.credit += r.credit;
      if (r.opening > 0) t.openingDebit += r.opening;
      else t.openingCredit -= r.opening;
      if (r.closing > 0) t.closingDebit += r.closing;
      else t.closingCredit -= r.closing;
      return t;
    },
    { debit: 0, credit: 0, openingDebit: 0, openingCredit: 0, closingDebit: 0, closingCredit: 0 },
  );
  (Object.keys(totals) as (keyof typeof totals)[]).forEach((k) => (totals[k] = round2(totals[k])));
  return { rows, totals };
}

/** 按科目余额方向展示：{ side: "借" | "贷" | "平", amount } */
export function balanceSide(signed: number, type: string) {
  const v = round2(signed);
  if (v === 0) return { side: "平" as const, amount: 0 };
  if (isDebitNormal(type)) return v > 0 ? { side: "借" as const, amount: v } : { side: "贷" as const, amount: -v };
  return v < 0 ? { side: "贷" as const, amount: -v } : { side: "借" as const, amount: v };
}

/** 单科目余额（借 - 贷） */
export async function accountSignedBalance(code: string) {
  const r = await db.journalLine.aggregate({ where: { account: { code } }, _sum: { debit: true, credit: true } });
  return round2((r._sum.debit ?? 0) - (r._sum.credit ?? 0));
}
