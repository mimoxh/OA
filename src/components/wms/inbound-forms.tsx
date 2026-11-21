"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { ItemLines, newLine, type Line, type ProductOption } from "@/components/wms/item-lines";
import { cancelInbound, confirmReceive, createInbound } from "@/app/(app)/wms/actions";
import { cn } from "@/lib/utils";

export function NewInboundButton({ warehouses, products }: { warehouses: { id: string; name: string }[]; products: ProductOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("OTHER");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [expectedDate, setExpectedDate] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const { run, pending } = useAction();

  const reset = () => {
    setType("OTHER");
    setWarehouseId(warehouses[0]?.id ?? "");
    setExpectedDate("");
    setRemark("");
    setLines([newLine()]);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="size-3.5" />
          新建入库
        </Button>
      </DialogTrigger>
      <DialogContent
        size="lg"
        title="新建手工入库单"
        description="退货或其他入库；采购入库单由采购订单审批通过后自动生成"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    createInbound({
                      type,
                      warehouseId,
                      expectedDate,
                      remark,
                      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                    }),
                  {
                    success: "入库单已创建",
                    onSuccess: (d) => {
                      setOpen(false);
                      router.push(`/wms/inbound/${d.id}`);
                    },
                  },
                )
              }
            >
              创建入库单
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="入库类型" required>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="RETURN">退货入库</option>
              <option value="OTHER">其他入库</option>
            </Select>
          </Field>
          <Field label="入库仓库" required>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="预计到货">
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4">
          <ItemLines products={products} lines={lines} onChange={setLines} />
        </div>
        <Field label="备注" className="mt-4">
          <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="例如：客户退货、样品归还" />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

export type ReceiveItem = {
  id: string;
  product: { sku: string; name: string; unit: string };
  expectedQty: number;
  locationId: string | null;
};

export function ReceiveForm({
  inboundId,
  items,
  locations,
  canEdit,
}: {
  inboundId: string;
  items: ReceiveItem[];
  locations: { id: string; code: string; zone: string | null }[];
  canEdit: boolean;
}) {
  const [values, setValues] = useState<Record<string, { qty: string; loc: string }>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { qty: String(i.expectedQty), loc: i.locationId ?? "" }])),
  );
  const { run, pending } = useAction();
  const set = (id: string, patch: Partial<{ qty: string; loc: string }>) => setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }));
  const totalExpected = items.reduce((s, i) => s + i.expectedQty, 0);
  const totalReceived = items.reduce((s, i) => s + (Number(values[i.id]?.qty) || 0), 0);
  const partial = totalReceived < totalExpected;

  return (
    <div>
      <Table>
        <THead>
          <TR>
            <TH>产品</TH>
            <TH className="text-right">应收</TH>
            <TH className="w-32">实收</TH>
            <TH className="w-48">上架库位</TH>
          </TR>
        </THead>
        <TBody>
          {items.map((i) => {
            const v = values[i.id];
            const over = Number(v.qty) > i.expectedQty;
            return (
              <TR key={i.id}>
                <TD>
                  <div>{i.product.name}</div>
                  <div className="text-xs text-ink-3">{i.product.sku}</div>
                </TD>
                <TD className="text-right tabular-nums">
                  {i.expectedQty} {i.product.unit}
                </TD>
                <TD>
                  <Input
                    type="number"
                    min={0}
                    max={i.expectedQty}
                    value={v.qty}
                    disabled={!canEdit}
                    onChange={(e) => set(i.id, { qty: e.target.value })}
                    className={cn("h-7 tabular-nums", over && "border-danger")}
                  />
                </TD>
                <TD>
                  <Select value={v.loc} disabled={!canEdit} onChange={(e) => set(i.id, { loc: e.target.value })} className="h-7">
                    <option value="">不指定</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code}
                        {l.zone ? ` · ${l.zone}` : ""}
                      </option>
                    ))}
                  </Select>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-ink-2">
            应收合计 <span className="tabular-nums text-ink">{totalExpected}</span>，本次实收{" "}
            <span className={cn("tabular-nums", partial ? "text-[#cb912f]" : "text-ink")}>{totalReceived}</span>
            {partial && totalReceived > 0 && <span className="ml-2 text-xs text-ink-3">部分到货，采购入库会自动生成剩余入库单</span>}
          </div>
          <div className="flex items-center gap-2">
            <ConfirmButton
              danger
              title="取消入库单"
              description="取消后该入库单不能再收货，确定继续吗？"
              confirmText="取消入库单"
              onConfirm={() => run(() => cancelInbound(inboundId), { success: "入库单已取消" })}
            >
              取消入库单
            </ConfirmButton>
            <ConfirmButton
              variant="primary"
              title="确认收货"
              description={`本次实收 ${totalReceived} 件，确认后将增加库存并写入库存流水。`}
              confirmText="确认收货"
              disabled={pending}
              onConfirm={() =>
                run(
                  () =>
                    confirmReceive({
                      inboundId,
                      items: items.map((i) => ({ id: i.id, receivedQty: values[i.id].qty, locationId: values[i.id].loc || null })),
                    }),
                  { success: "收货完成，库存已更新" },
                )
              }
            >
              <PackageCheck className="size-3.5" />
              确认收货
            </ConfirmButton>
          </div>
        </div>
      )}
    </div>
  );
}
