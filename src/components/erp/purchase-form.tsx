"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Section } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { LineItemsEditor, newLine, serializeLines, type LineDraft, type LineProduct } from "@/components/erp/line-items-editor";
import { savePurchaseOrder } from "@/app/(app)/erp/actions";

export type PurchaseFormInitial = {
  id?: string;
  supplierId: string;
  warehouseId: string;
  expectedDate: string;
  remark: string;
  items: { productId: string; quantity: number; price: number }[];
};

export function PurchaseForm({
  initial,
  suppliers,
  warehouses,
  products,
  rejected,
}: {
  initial: PurchaseFormInitial;
  suppliers: { id: string; code: string; name: string }[];
  warehouses: { id: string; name: string }[];
  products: LineProduct[];
  rejected?: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [mode, setMode] = useState<"draft" | "submit">("draft");
  const [head, setHead] = useState({
    supplierId: initial.supplierId,
    warehouseId: initial.warehouseId,
    expectedDate: initial.expectedDate,
    remark: initial.remark,
  });
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial.items.length
      ? initial.items.map((i) => newLine({ productId: i.productId, quantity: String(i.quantity), price: String(i.price) }))
      : [newLine()],
  );

  function save(submit: boolean) {
    setMode(submit ? "submit" : "draft");
    run(
      () =>
        savePurchaseOrder({
          id: initial.id,
          ...head,
          items: serializeLines(lines),
          submit,
        }),
      {
        success: submit ? "采购单已保存并提交审批" : "采购单草稿已保存",
        refresh: false,
        onSuccess: (d) => router.push(`/erp/purchase/${d.id}`),
      },
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="供应商" required>
          <Select value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}>
            <option value="">选择供应商…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.code}）
              </option>
            ))}
          </Select>
        </Field>
        <Field label="入库仓库" required>
          <Select value={head.warehouseId} onChange={(e) => setHead({ ...head, warehouseId: e.target.value })}>
            <option value="">选择仓库…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="预计到货日期">
          <Input type="date" value={head.expectedDate} onChange={(e) => setHead({ ...head, expectedDate: e.target.value })} />
        </Field>
        <Field label="备注" className="sm:col-span-3">
          <Textarea rows={2} value={head.remark} onChange={(e) => setHead({ ...head, remark: e.target.value })} placeholder="采购说明、付款条件等" />
        </Field>
      </div>

      <Section title="采购明细" className="mt-6">
        <LineItemsEditor products={products} lines={lines} onChange={setLines} priceLabel="采购单价" />
        <p className="mt-2 text-xs text-ink-3">单价默认带出产品当前成本，可按实际采购价修改。</p>
      </Section>

      <div className="mt-8 flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href={initial.id ? `/erp/purchase/${initial.id}` : "/erp/purchase"} variant="ghost">
          取消
        </LinkButton>
        <Button type="submit" loading={pending && mode === "draft"} disabled={pending}>
          {rejected ? "保存为草稿" : "保存草稿"}
        </Button>
        <Button variant="primary" loading={pending && mode === "submit"} disabled={pending} onClick={() => save(true)}>
          <Send className="size-3.5" />
          {rejected ? "保存并重新提交审批" : "保存并提交审批"}
        </Button>
      </div>
    </form>
  );
}
