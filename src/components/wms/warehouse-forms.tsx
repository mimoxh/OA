"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAction } from "@/components/ui/use-action";
import { deleteLocation, deleteWarehouse, saveLocation, saveWarehouse } from "@/app/(app)/wms/actions";
import { LOCATION_TYPE_OPTIONS } from "@/lib/wms/constants";

export type WarehouseValues = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  managerId: string | null;
  active: boolean;
};

export function WarehouseDialog({
  warehouse,
  users,
  trigger,
}: {
  warehouse?: WarehouseValues;
  users: { id: string; name: string }[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const init = () => ({
    code: warehouse?.code ?? "",
    name: warehouse?.name ?? "",
    address: warehouse?.address ?? "",
    managerId: warehouse?.managerId ?? "",
    active: warehouse?.active ?? true,
  });
  const [v, setV] = useState(init);
  const { run, pending } = useAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(init());
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={warehouse ? "编辑仓库" : "新建仓库"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => saveWarehouse({ id: warehouse?.id, ...v, managerId: v.managerId || null }), {
                  success: warehouse ? "仓库已保存" : "仓库已创建",
                  onSuccess: (d) => {
                    setOpen(false);
                    if (!warehouse) router.push(`/wms/warehouses/${d.id}`);
                  },
                })
              }
            >
              保存
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="仓库编码" required hint="全局唯一，例如 WH03">
            <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus />
          </Field>
          <Field label="仓库名称" required>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="地址" className="col-span-2" hint="发货时作为运输单起点">
            <Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
          </Field>
          <Field label="负责人">
            <Select value={v.managerId} onChange={(e) => setV({ ...v, managerId: e.target.value })}>
              <option value="">未指定</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="状态">
            <div className="flex h-8 items-center">
              <Checkbox label="启用" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
            </div>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteWarehouseButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <ConfirmButton
      danger
      title={`删除仓库「${name}」`}
      description="只有没有库存和业务单据的仓库可以删除，删除后库位一并删除。"
      confirmText="删除"
      onConfirm={() => run(() => deleteWarehouse(id), { success: "仓库已删除", onSuccess: () => router.push("/wms/warehouses") })}
    >
      <Trash2 className="size-3.5" />
      删除
    </ConfirmButton>
  );
}

export type LocationValues = { id: string; code: string; zone: string | null; type: string };

export function LocationDialog({ warehouseId, location, trigger }: { warehouseId: string; location?: LocationValues; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const init = () => ({ code: location?.code ?? "", zone: location?.zone ?? "", type: location?.type ?? "storage" });
  const [v, setV] = useState(init);
  const { run, pending } = useAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(init());
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="sm"
        title={location ? "编辑库位" : "新建库位"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => saveLocation({ id: location?.id, warehouseId, ...v }), {
                  success: "库位已保存",
                  onSuccess: () => setOpen(false),
                })
              }
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="库位编码" required hint="仓库内唯一，例如 A-03-01">
            <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus />
          </Field>
          <Field label="库区">
            <Input value={v.zone} onChange={(e) => setV({ ...v, zone: e.target.value })} placeholder="例如：A 区" />
          </Field>
          <Field label="类型" required>
            <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
              {LOCATION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LocationRowActions({ warehouseId, location }: { warehouseId: string; location: LocationValues }) {
  const { run } = useAction();
  return (
    <div className="flex items-center justify-end gap-0.5">
      <LocationDialog
        warehouseId={warehouseId}
        location={location}
        trigger={
          <IconButton aria-label="编辑库位" title="编辑">
            <Pencil className="size-3.5" />
          </IconButton>
        }
      />
      <ConfirmButton
        variant="ghost"
        size="xs"
        danger
        title={`删除库位 ${location.code}`}
        description="删除后，引用该库位的库存默认库位将被清空。"
        confirmText="删除"
        onConfirm={() => run(() => deleteLocation(location.id), { success: "库位已删除" })}
        aria-label="删除库位"
        className="text-ink-3 hover:text-danger"
      >
        <Trash2 className="size-3.5" />
      </ConfirmButton>
    </div>
  );
}
