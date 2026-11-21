"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { ItemLines, newLine, type Line, type ProductOption } from "@/components/wms/item-lines";
import { cancelOutbound, confirmShip, createOutbound, startPick } from "@/app/(app)/wms/actions";

export function NewOutboundButton({
  warehouses,
  products,
  available,
}: {
  warehouses: { id: string; name: string }[];
  products: ProductOption[];
  available: Record<string, Record<string, number>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const { run, pending } = useAction();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setWarehouseId(warehouses[0]?.id ?? "");
          setRemark("");
          setLines([newLine()]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="size-3.5" />
          新建出库
        </Button>
      </DialogTrigger>
      <DialogContent
        size="lg"
        title="新建手工出库单"
        description="领用、报损等其他出库；销售出库单由销售订单确认后自动生成"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    createOutbound({
                      warehouseId,
                      remark,
                      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                    }),
                  {
                    success: "出库单已创建",
                    onSuccess: (d) => {
                      setOpen(false);
                      router.push(`/wms/outbound/${d.id}`);
                    },
                  },
                )
              }
            >
              创建出库单
            </Button>
          </>
        }
      >
        <Field label="出库仓库" required className="w-60">
          <Select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setLines([newLine()]);
            }}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="mt-4">
          <ItemLines products={products} lines={lines} onChange={setLines} available={available[warehouseId] ?? {}} />
        </div>
        <Field label="备注 / 用途" className="mt-4">
          <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="例如：研发部领用测试样机" />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

export function OutboundActions({
  id,
  status,
  type,
  canEdit,
}: {
  id: string;
  status: string;
  type: string;
  canEdit: boolean;
}) {
  const { run, pending } = useAction();
  const [transport, setTransport] = useState<{ id: string; no: string } | null>(null);
  const open = status === "PENDING" || status === "PICKING";
  return (
    <div className="flex items-center gap-2">
      <Button onClick={() => window.print()}>
        <Printer className="size-3.5" />
        打印拣货单
      </Button>
      {canEdit && open && type === "OTHER" && (
        <ConfirmButton
          danger
          title="取消出库单"
          description="取消后该出库单不再发货，确定继续吗？"
          confirmText="取消出库单"
          onConfirm={() => run(() => cancelOutbound(id), { success: "出库单已取消" })}
        >
          取消
        </ConfirmButton>
      )}
      {canEdit && status === "PENDING" && (
        <Button variant="default" loading={pending} onClick={() => run(() => startPick(id), { success: "已开始拣货" })}>
          <ClipboardList className="size-3.5" />
          开始拣货
        </Button>
      )}
      {canEdit && open && (
        <ConfirmButton
          variant="primary"
          title="确认发货"
          description={
            type === "SALES" ? "确认后扣减库存、结转销售成本，并自动生成运输单等待调度。" : "确认后将扣减库存并写入出库流水。"
          }
          confirmText="确认发货"
          disabled={pending}
          onConfirm={() =>
            run(() => confirmShip(id), {
              success: "已发货出库",
              onSuccess: (d) => {
                if (d.transportId && d.transportNo) setTransport({ id: d.transportId, no: d.transportNo });
              },
            })
          }
        >
          <Truck className="size-3.5" />
          确认发货
        </ConfirmButton>
      )}
      {transport && (
        <Link href={`/tms/orders/${transport.id}`} className="text-[13px] text-accent hover:underline">
          已生成运输单 {transport.no} →
        </Link>
      )}
    </div>
  );
}
