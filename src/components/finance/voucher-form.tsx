"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button, IconButton, LinkButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { formatMoney, toDateInput } from "@/lib/format";
import { ACCOUNT_TYPE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { createManualVoucher } from "@/app/(app)/finance/actions";

type Line = { key: number; account: string; debit: string; credit: string; memo: string };
let seq = 0;
const blank = (): Line => ({ key: ++seq, account: "", debit: "", credit: "", memo: "" });
const n = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function VoucherForm({ accounts }: { accounts: { code: string; name: string; type: keyof typeof ACCOUNT_TYPE }[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [blank(), blank()]);

  const debit = r2(lines.reduce((s, l) => s + n(l.debit), 0));
  const credit = r2(lines.reduce((s, l) => s + n(l.credit), 0));
  const filled = lines.filter((l) => l.account && (n(l.debit) > 0 || n(l.credit) > 0));
  const balanced = debit === credit && debit > 0;
  const bothSides = lines.some((l) => n(l.debit) > 0 && n(l.credit) > 0);
  const missingAccount = lines.some((l) => !l.account && (n(l.debit) > 0 || n(l.credit) > 0));
  const canSubmit = balanced && filled.length >= 2 && !bothSides && !missingAccount && memo.trim().length > 0;

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function autoBalance(key: number) {
    const others = lines.filter((l) => l.key !== key);
    const d = r2(others.reduce((s, l) => s + n(l.debit), 0));
    const c = r2(others.reduce((s, l) => s + n(l.credit), 0));
    if (d > c) update(key, { credit: String(r2(d - c)), debit: "" });
    else if (c > d) update(key, { debit: String(r2(c - d)), credit: "" });
  }

  function submit() {
    run(
      () =>
        createManualVoucher({
          date,
          memo,
          lines: filled.map((l) => ({ account: l.account, debit: n(l.debit), credit: n(l.credit), memo: l.memo })),
        }),
      { success: "凭证已保存", refresh: false, onSuccess: (d) => router.push(`/finance/vouchers/${d.id}`) },
    );
  }

  const grouped = Object.entries(ACCOUNT_TYPE).map(([type, m]) => ({ label: m.label, items: accounts.filter((a) => a.type === type) }));

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
        <Field label="凭证日期" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="摘要" required>
          <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="如：支付 6 月办公室租金" />
        </Field>
      </div>

      <div className="mt-6 rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-sidebar/60 text-left text-xs text-ink-2">
              <th className="w-10 px-3 py-2 font-normal">#</th>
              <th className="px-2 py-2 font-normal">会计科目</th>
              <th className="px-2 py-2 font-normal">分录摘要</th>
              <th className="w-36 px-2 py-2 font-normal">借方金额</th>
              <th className="w-36 px-2 py-2 font-normal">贷方金额</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="border-b border-line last:border-b-0">
                <td className="px-3 py-1.5 text-xs text-ink-3">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <Select value={l.account} onChange={(e) => update(l.key, { account: e.target.value })} className={cn(!l.account && "text-ink-3")}>
                    <option value="">选择科目…</option>
                    {grouped
                      .filter((g) => g.items.length)
                      .map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.items.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <Input value={l.memo} onChange={(e) => update(l.key, { memo: e.target.value })} placeholder={memo || "可选"} />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.debit}
                    onChange={(e) => update(l.key, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })}
                    onDoubleClick={() => autoBalance(l.key)}
                    className="tabular-nums"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.credit}
                    onChange={(e) => update(l.key, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })}
                    onDoubleClick={() => autoBalance(l.key)}
                    className="tabular-nums"
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <IconButton aria-label="删除分录" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-sidebar/40">
              <td colSpan={3} className="px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
                  <Plus className="size-3.5" />
                  添加分录
                </Button>
              </td>
              <td className="px-2 py-2 font-semibold tabular-nums">{formatMoney(debit)}</td>
              <td className="px-2 py-2 font-semibold tabular-nums">{formatMoney(credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        {balanced ? (
          <span className="flex items-center gap-1.5 text-[#448361]">
            <CheckCircle2 className="size-4" />
            借贷平衡
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-danger">
            <TriangleAlert className="size-4" />
            {debit === 0 && credit === 0 ? "请填写分录金额" : `借贷不平衡，差额 ${formatMoney(Math.abs(debit - credit))}`}
          </span>
        )}
        <span className="text-xs text-ink-3">提示：双击金额框可自动填入使凭证平衡的差额</span>
      </div>
      {(bothSides || missingAccount) && (
        <p className="mt-1 text-xs text-danger">{bothSides ? "同一行分录不能同时填写借方和贷方。" : "有分录填写了金额但未选择科目。"}</p>
      )}

      <div className="mt-8 flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href="/finance/vouchers" variant="ghost">
          取消
        </LinkButton>
        <Button variant="primary" disabled={!canSubmit} loading={pending} onClick={submit}>
          保存凭证
        </Button>
      </div>
    </div>
  );
}
