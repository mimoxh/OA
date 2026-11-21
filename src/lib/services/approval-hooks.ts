import type { Tx } from "@/lib/db";
import type { ApprovalInstance } from "@/generated/prisma/client";
import { ACCOUNT, postJournal } from "@/lib/services/ledger";
import { onPurchaseApproved } from "@/lib/services/flows";

type Hook = (tx: Tx, instance: ApprovalInstance, userId: string) => Promise<unknown>;

/**
 * 审批结束后的业务回调。键为 instance.bizType，没有 bizType 时为流程 key。
 */
export const approvalHooks: Record<string, { onApproved?: Hook; onRejected?: Hook; onWithdrawn?: Hook }> = {
  purchase_order: {
    onApproved: (tx, inst, userId) => onPurchaseApproved(tx, inst.bizId!, userId),
    onRejected: (tx, inst) =>
      tx.purchaseOrder.update({ where: { id: inst.bizId! }, data: { status: "REJECTED" } }),
    onWithdrawn: (tx, inst) =>
      tx.purchaseOrder.update({ where: { id: inst.bizId! }, data: { status: "DRAFT" } }),
  },
  expense: {
    // 报销审批通过：借 管理费用，贷 银行存款
    onApproved: async (tx, inst) => {
      const form = JSON.parse(inst.formData || "{}") as { amount?: number | string; reason?: string };
      const amount = Number(form.amount ?? 0);
      if (!(amount > 0)) return;
      await postJournal(tx, {
        memo: `费用报销：${inst.title}`,
        sourceType: "expense",
        sourceId: inst.id,
        userId: inst.applicantId,
        lines: [
          { account: ACCOUNT.ADMIN_EXPENSE, debit: amount },
          { account: ACCOUNT.BANK, credit: amount },
        ],
      });
    },
  },
};
