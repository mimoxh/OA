"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { convertOpportunityToOrder } from "@/app/(app)/crm/actions";

export type ConvertProduct = { id: string; name: string; sku: string; unit: string; price: number };
type Row = { key: number; productId: string; quantity: string; price: string };

export function ConvertOrderDialog({
  opportunity,
  defaults,
  warehouses,
  products,
  stock,
}: {
  opportunity: { id: string; name: string; amount: number };
  defaults: { shippingAddress: string; consignee: string; consigneePhone: string };
  warehouses: { id: string; name: string }[];
  products: ConvertProduct[];
  /** warehouseId → productId → 可用库存（库存 - 已预占） */
  stock: Record<string, Record<string, number>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [addr, setAddr] = useState(defaults);
  const [seq, setSeq] = useState(1);
  const { run, pending } = useAction();

  const reset = () => {
    setWarehouseId(warehouses[0]?.id ?? "");
    setRows([{ key: 0, productId: "", quantity: "1", price: "" }]);
    setAddr(defaults);
    setSeq(1);
  };
  const updateRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.price) || 0), 0);
  const avail = (pid: string) => stock[warehouseId]?.[pid] ?? 0;

  const submit = () =>
    run(
      () =>
        convertOpportunityToOrder({
          opportunityId: opportunity.id,
          warehouseId,
          items: rows.filter((r) => r.productId).map((r) => ({ productId: r.productId, quantity: r.quantity, price: r.price || 0 })),
          shippingAddress: addr.shippingAddress,
          consignee: addr.consignee,
          consigneePhone: addr.consigneePhone,
        }),
      {
        success: "销售订单已创建",
        refresh: false,
        onSuccess: (d) => {
          setOpen(false);
          router.push(`/erp/sales/${d.id}`);
        },
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) reset();
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <ShoppingCart className="size-3.5" />
          转为销售订单
        </Button>
      </DialogTrigger>
      <DialogContent
        size="xl"
        title="转为销售订单"
        description={`商机「${opportunity.name}」将标记为赢单，并生成草稿状态的销售订单。`}
        footer={
          <>
            <span className="mr-auto text-sm text-ink-2">
              订单合计 <span className="text-base font-semibold tabular-nums text-ink">{formatMoney(total)}</span>
              {opportunity.amount > 0 && <span className="ml-2 text-xs text-ink-3">商机金额 {formatMoney(opportunity.amount)}</span>}
            </span>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              创建销售订单
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-2">
          <Field label="发货仓库" required className="w-64">
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-2">产品明细</div>
            <div className="rounded-md border border-line">
              <div className="grid grid-cols-[1fr_110px_90px_120px_110px_32px] gap-2 border-b border-line px-2 py-1.5 text-xs text-ink-2">
                <span>产品</span>
                <span className="text-right">可用库存</span>
                <span>数量</span>
                <span>单价</span>
                <span className="text-right">小计</span>
                <span />
              </div>
              {rows.map((r) => {
                const a = r.productId ? avail(r.productId) : null;
                const short = a !== null && Number(r.quantity) > a;
                return (
                  <div key={r.key} className="grid grid-cols-[1fr_110px_90px_120px_110px_32px] items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0">
                    <Select
                      value={r.productId}
                      onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value);
                        updateRow(r.key, { productId: e.target.value, price: p ? String(p.price) : "" });
                      }}
                    >
                      <option value="">选择产品</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id} disabled={rows.some((x) => x.key !== r.key && x.productId === p.id)}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                    </Select>
                    <span className={cn("text-right text-sm tabular-nums", short ? "text-danger" : "text-ink-2")}>
                      {a === null ? "—" : `${a} ${products.find((p) => p.id === r.productId)?.unit ?? ""}`}
                    </span>
                    <Input type="number" min={1} step={1} value={r.quantity} onChange={(e) => updateRow(r.key, { quantity: e.target.value })} className={cn(short && "border-danger")} />
                    <Input type="number" min={0} step="0.01" value={r.price} onChange={(e) => updateRow(r.key, { price: e.target.value })} />
                    <span className="text-right text-sm tabular-nums">{formatMoney((Number(r.quantity) || 0) * (Number(r.price) || 0))}</span>
                    <IconButton aria-label="删除行" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                );
              })}
            </div>
            <Button
              size="xs"
              variant="ghost"
              className="mt-1"
              onClick={() => {
                setRows((rs) => [...rs, { key: seq, productId: "", quantity: "1", price: "" }]);
                setSeq((s) => s + 1);
              }}
            >
              <Plus className="size-3.5" />
              添加产品
            </Button>
            {rows.some((r) => r.productId && Number(r.quantity) > avail(r.productId)) && (
              <p className="mt-1 text-xs text-danger">部分产品可用库存不足，订单确认时将无法预占库存。</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="收货地址" className="col-span-3">
              <Input value={addr.shippingAddress} onChange={(e) => setAddr((a) => ({ ...a, shippingAddress: e.target.value }))} />
            </Field>
            <Field label="收货人">
              <Input value={addr.consignee} onChange={(e) => setAddr((a) => ({ ...a, consignee: e.target.value }))} />
            </Field>
            <Field label="联系电话">
              <Input value={addr.consigneePhone} onChange={(e) => setAddr((a) => ({ ...a, consigneePhone: e.target.value }))} />
            </Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
