import type { Tx } from "@/lib/db";
import { nextNo } from "@/lib/sequence";

export const ACCOUNT = {
  CASH: "1001",
  BANK: "1002",
  AR: "1122",
  INVENTORY: "1405",
  AP: "2202",
  CAPITAL: "4001",
  REVENUE: "6001",
  COGS: "6401",
  SELLING_EXPENSE: "6601",
  ADMIN_EXPENSE: "6602",
} as const;

export const DEFAULT_ACCOUNTS = [
  { code: "1001", name: "库存现金", type: "ASSET" },
  { code: "1002", name: "银行存款", type: "ASSET" },
  { code: "1122", name: "应收账款", type: "ASSET" },
  { code: "1405", name: "库存商品", type: "ASSET" },
  { code: "2202", name: "应付账款", type: "LIABILITY" },
  { code: "4001", name: "实收资本", type: "EQUITY" },
  { code: "6001", name: "主营业务收入", type: "REVENUE" },
  { code: "6401", name: "主营业务成本", type: "EXPENSE" },
  { code: "6601", name: "销售费用", type: "EXPENSE" },
  { code: "6602", name: "管理费用", type: "EXPENSE" },
] as const;

export type JournalLineInput = { account: string; debit?: number; credit?: number; memo?: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 记账：借贷必须平衡。返回凭证。 */
export async function postJournal(
  tx: Tx,
  input: { memo: string; date?: Date; sourceType: string; sourceId?: string; userId: string; lines: JournalLineInput[] },
) {
  const lines = input.lines
    .map((l) => ({ ...l, debit: round2(l.debit ?? 0), credit: round2(l.credit ?? 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  if (lines.length < 2) throw new Error("凭证至少需要两条分录");
  const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (debit !== credit) throw new Error(`借贷不平衡：借方 ${debit}，贷方 ${credit}`);

  const codes = [...new Set(lines.map((l) => l.account))];
  const accounts = await tx.account.findMany({ where: { code: { in: codes } } });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  for (const c of codes) if (!byCode.has(c)) throw new Error(`会计科目不存在：${c}`);

  return tx.journalEntry.create({
    data: {
      no: await nextNo(tx, "JV"),
      date: input.date ?? new Date(),
      memo: input.memo,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      createdById: input.userId,
      lines: {
        create: lines.map((l) => ({
          accountId: byCode.get(l.account)!,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo ?? null,
        })),
      },
    },
  });
}
