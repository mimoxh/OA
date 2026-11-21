"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Section } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { LineItemsEditor, newLine, serializeLines, type LineDraft, type LineProduct } from "@/components/erp/line-items-editor";
import { saveSalesOrder } from "@/app/(app)/erp/actions";

export type SalesCustomerOption = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  contact: { name: string; phone: string | null } | null;
  opportunities: { id: string; name: string; stageLabel: string }[];
};

export type SalesFormInitial = {
  id?: string;
  customerId: string;
  opportunityId: string;
  warehouseId: string;
  shippingAddress: string;
  consignee: string;
  consigneePhone: string;
  orderDate: string;
  remark: string;
  items: { productId: string; quantity: number; price: number }[];
};

export function SalesForm({
  initial,
  customers,
  warehouses,
  products,
  stock,
}: {
  initial: SalesFormInitial;
  customers: SalesCustomerOption[];
  warehouses: { id: string; name: string }[];
  products: LineProduct[];
  /** warehouseId → productId → 可用库存 */
  stock: Record<string, Record<string, number>>;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [mode, setMode] = useState<"draft" | "confirm">("draft");
  const [head, setHead] = useState(() => {
    const c = customers.find((x) => x.id === initial.customerId);
    // 通过 ?customerId= 进入新建时自动带出联系人与地址
    if (!initial.id && c) {
      return {
        ...initial,
        shippingAddress: initial.shippingAddress || c.address || "",
        consignee: initial.consignee || c.contact?.name || "",
        consigneePhone: initial.consigneePhone || c.contact?.phone || c.phone || "",
      };
    }
    return initial;
  });
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial.items.length
      ? initial.items.map((i) => newLine({ productId: i.productId, quantity: String(i.quantity), price: String(i.price) }))
      : [newLine()],
  );
  const customer = customers.find((c) => c.id === head.customerId);
  const whStock = head.warehouseId ? (stock[head.warehouseId] ?? {}) : null;
  const shortage = whStock
    ? lines.filter((l) => l.productId && (Number(l.quantity) || 0) > (whStock[l.productId] ?? 0)).length
    : 0;

  function pickCustomer(id: string) {
    const c = customers.find((x) => x.id === id);
    setHead((h) => ({
      ...h,
      customerId: id,
      opportunityId: "",
      shippingAddress: c?.address ?? "",
      consignee: c?.contact?.name ?? "",
      consigneePhone: c?.contact?.phone ?? c?.phone ?? "",
    }));
  }

  function save(confirm: boolean) {
    setMode(confirm ? "confirm" : "draft");
    run(
      () =>
        saveSalesOrder({
          id: initial.id,
          customerId: head.customerId,
          opportunityId: initial.id ? null : head.opportunityId,
          warehouseId: head.warehouseId,
          shippingAddress: head.shippingAddress,
          consignee: head.consignee,
          consigneePhone: head.consigneePhone,
          orderDate: head.orderDate,
          remark: head.remark,
          items: serializeLines(lines),
          confirm,
        }),
      {
        success: confirm ? "订单已确认，库存已预占并生成出库单" : "销售订单草稿已保存",
        refresh: false,
        onSuccess: (d) => router.push(`/erp/sales/${d.id}`),
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
        <Field label="客户" required>
          <Select value={head.customerId} onChange={(e) => pickCustomer(e.target.value)}>
            <option value="">选择客户…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="关联商机" hint={initial.id ? "创建后不可修改" : "选择后订单保存时商机自动标记为赢单"}>
          <Select
            value={head.opportunityId}
            disabled={!!initial.id || !customer?.opportunities.length}
            onChange={(e) => setHead({ ...head, opportunityId: e.target.value })}
          >
            <option value="">{customer?.opportunities.length ? "不关联商机" : "该客户暂无进行中的商机"}</option>
            {customer?.opportunities.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}（{o.stageLabel}）
              </option>
            ))}
          </Select>
        </Field>
        <Field label="发货仓库" required>
          <Select value={head.warehouseId} onChange={(e) => setHead({ ...head, warehouseId: e.target.value })}>
            <option value="">选择仓库…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="收货人">
          <Input value={head.consignee} onChange={(e) => setHead({ ...head, consignee: e.target.value })} />
        </Field>
        <Field label="联系电话">
          <Input value={head.consigneePhone} onChange={(e) => setHead({ ...head, consigneePhone: e.target.value })} />
        </Field>
        <Field label="下单日期">
          <Input type="date" value={head.orderDate} onChange={(e) => setHead({ ...head, orderDate: e.target.value })} />
        </Field>
        <Field label="收货地址" required className="sm:col-span-3">
          <Input value={head.shippingAddress} onChange={(e) => setHead({ ...head, shippingAddress: e.target.value })} />
        </Field>
        <Field label="备注" className="sm:col-span-3">
          <Textarea rows={2} value={head.remark} onChange={(e) => setHead({ ...head, remark: e.target.value })} />
        </Field>
      </div>

      <Section title="订单明细" className="mt-6">
        <LineItemsEditor products={products} lines={lines} onChange={setLines} stock={whStock} priceLabel="销售单价" />
        {!head.warehouseId ? (
          <p className="mt-2 text-xs text-ink-3">选择发货仓库后显示各产品的可用库存（库存 − 已预占）。</p>
        ) : shortage > 0 ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-danger">
            <TriangleAlert className="size-3.5" />有 {shortage} 个产品可用库存不足，可先保存草稿，待补货后再确认订单。
          </p>
        ) : (
          <p className="mt-2 flex items-center gap-1 text-xs text-[#448361]">
            <CheckCircle2 className="size-3.5" />
            所选仓库库存充足。确认订单时将预占库存并自动生成出库单。
          </p>
        )}
      </Section>

      <div className="mt-8 flex items-center justify-end gap-2 border-t border-line pt-4">
        <LinkButton href={initial.id ? `/erp/sales/${initial.id}` : "/erp/sales"} variant="ghost">
          取消
        </LinkButton>
        <Button type="submit" loading={pending && mode === "draft"} disabled={pending}>
          保存草稿
        </Button>
        <Button variant="primary" loading={pending && mode === "confirm"} disabled={pending} onClick={() => save(true)}>
          保存并确认订单
        </Button>
      </div>
    </form>
  );
}
