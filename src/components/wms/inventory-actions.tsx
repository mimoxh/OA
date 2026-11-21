"use client";

import { useState } from "react";
import { ArrowLeftRight, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { adjustInventory, transferInventory } from "@/app/(app)/wms/actions";

export type InventoryRowInfo = {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  reservedQty: number;
};

function Summary({ row }: { row: InventoryRowInfo }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-2 rounded-md bg-sidebar px-3 py-2 text-[13px]">
      <div className="col-span-3 font-medium text-ink">
        {row.productName} <span className="font-normal text-ink-3">{row.sku}</span>
      </div>
      <div>
        <div className="text-xs text-ink-3">仓库</div>
        {row.warehouseName}
      </div>
      <div>
        <div className="text-xs text-ink-3">库存 / 预占</div>
        <span className="tabular-nums">
          {row.quantity} / {row.reservedQty}
        </span>
      </div>
      <div>
        <div className="text-xs text-ink-3">可用</div>
        <span className="tabular-nums">
          {row.quantity - row.reservedQty} {row.unit}
        </span>
      </div>
    </div>
  );
}

export function TransferButton({ row, warehouses }: { row: InventoryRowInfo; warehouses: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const targets = warehouses.filter((w) => w.id !== row.warehouseId);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [memo, setMemo] = useState("");
  const { run, pending } = useAction();
  const available = row.quantity - row.reservedQty;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setQuantity("");
          setMemo("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs" disabled={available <= 0} title={available <= 0 ? "没有可用库存" : undefined}>
          <ArrowLeftRight className="size-3.5" />
          调拨
        </Button>
      </DialogTrigger>
      <DialogContent
        title="库存调拨"
        description="从当前仓库调出到目标仓库，生成调出 / 调入两条流水"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    transferInventory({
                      productId: row.productId,
                      fromWarehouseId: row.warehouseId,
                      toWarehouseId: to,
                      quantity,
                      memo: memo || undefined,
                    }),
                  { success: "调拨完成", onSuccess: () => setOpen(false) },
                )
              }
            >
              确认调拨
            </Button>
          </>
        }
      >
        <Summary row={row} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="调入仓库" required>
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {targets.length === 0 && <option value="">没有其他仓库</option>}
              {targets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="调拨数量" required hint={`最多 ${available} ${row.unit}`}>
            <Input type="number" min={1} max={available} value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </Field>
          <Field label="备注" className="col-span-2">
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例如：广州分仓补货" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustButton({ row }: { row: InventoryRowInfo }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(String(row.quantity));
  const [memo, setMemo] = useState("");
  const { run, pending } = useAction();
  const diff = quantity === "" ? 0 : Number(quantity) - row.quantity;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setQuantity(String(row.quantity));
          setMemo("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs">
          <ClipboardCheck className="size-3.5" />
          盘点
        </Button>
      </DialogTrigger>
      <DialogContent
        title="盘点调整"
        description="填写实盘数量，系统按差异生成盘点调整流水"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => adjustInventory({ productId: row.productId, warehouseId: row.warehouseId, newQuantity: quantity, memo }), {
                  success: diff === 0 ? "盘点无差异" : "盘点调整已完成",
                  onSuccess: () => setOpen(false),
                })
              }
            >
              确认调整
            </Button>
          </>
        }
      >
        <Summary row={row} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="实盘数量" required hint={row.reservedQty > 0 ? `不能低于已预占数量 ${row.reservedQty}` : undefined}>
            <Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </Field>
          <Field label="差异">
            <div
              className={`flex h-8 items-center text-sm font-medium tabular-nums ${diff > 0 ? "text-[#448361]" : diff < 0 ? "text-danger" : "text-ink-2"}`}
            >
              {diff > 0 ? `盘盈 +${diff}` : diff < 0 ? `盘亏 ${diff}` : "无差异"}
            </div>
          </Field>
          <Field label="盘点原因" required className="col-span-2">
            <Textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例如：月度盘点，发现 2 件包装破损报废" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
