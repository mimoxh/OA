"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { deleteDriver, deleteRoute, deleteVehicle, saveDriver, saveRoute, saveVehicle } from "@/app/(app)/tms/actions";
import { DRIVER_STATUS, VEHICLE_STATUS } from "@/lib/labels";
import type { ActionResult } from "@/lib/action";

function FormDialog({
  title,
  trigger,
  onOpen,
  onSubmit,
  pending,
  open,
  setOpen,
  children,
}: {
  title: string;
  trigger: ReactNode;
  onOpen: () => void;
  onSubmit: () => void;
  pending: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) onOpen();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={title}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={onSubmit}>
              保存
            </Button>
          </>
        }
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ edit, label, onDelete }: { edit: ReactNode; label: string; onDelete: () => Promise<ActionResult<void>> }) {
  const { run } = useAction();
  return (
    <div className="flex items-center justify-end gap-0.5">
      {edit}
      <ConfirmButton
        variant="ghost"
        size="xs"
        danger
        title={`删除${label}`}
        description="删除后不可恢复，确定继续吗？"
        confirmText="删除"
        onConfirm={() => run(onDelete, { success: "已删除" })}
        aria-label="删除"
        className="text-ink-3 hover:text-danger"
      >
        <Trash2 className="size-3.5" />
      </ConfirmButton>
    </div>
  );
}

const editIcon = (
  <IconButton aria-label="编辑" title="编辑">
    <Pencil className="size-3.5" />
  </IconButton>
);

// ───────────── 车辆 ─────────────

export type VehicleValues = { id: string; plateNo: string; type: string; capacity: number; status: string; remark: string | null };

export function VehicleDialog({ vehicle, trigger }: { vehicle?: VehicleValues; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const init = () => ({
    plateNo: vehicle?.plateNo ?? "",
    type: vehicle?.type ?? "4.2 米厢式货车",
    capacity: vehicle ? String(vehicle.capacity) : "4000",
    status: vehicle?.status ?? "AVAILABLE",
    remark: vehicle?.remark ?? "",
  });
  const [v, setV] = useState(init);
  const { run, pending } = useAction();
  const inUse = vehicle?.status === "IN_USE";
  return (
    <FormDialog
      title={vehicle ? `编辑车辆 ${vehicle.plateNo}` : "新建车辆"}
      trigger={trigger}
      open={open}
      setOpen={setOpen}
      pending={pending}
      onOpen={() => setV(init())}
      onSubmit={() =>
        run(() => saveVehicle({ id: vehicle?.id, ...v }), { success: vehicle ? "车辆已保存" : "车辆已创建", onSuccess: () => setOpen(false) })
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="车牌号" required hint="唯一，例如 沪A·12345">
          <Input value={v.plateNo} onChange={(e) => setV({ ...v, plateNo: e.target.value })} autoFocus />
        </Field>
        <Field label="车型" required>
          <Input value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} list="vehicle-types" />
          <datalist id="vehicle-types">
            {["面包车", "4.2 米厢式货车", "6.8 米厢式货车", "9.6 米厢式货车", "冷藏车"].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="载重（kg）" required>
          <Input type="number" min={1} value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} />
        </Field>
        <Field label="状态" required hint={inUse ? "运输中的车辆在签收后自动恢复空闲" : undefined}>
          <Select value={v.status} disabled={inUse} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {Object.entries(VEHICLE_STATUS)
              .filter(([k]) => k !== "IN_USE" || inUse)
              .map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="备注" className="col-span-2">
          <Textarea rows={2} value={v.remark} onChange={(e) => setV({ ...v, remark: e.target.value })} />
        </Field>
      </div>
    </FormDialog>
  );
}

export function VehicleRowActions({ vehicle }: { vehicle: VehicleValues }) {
  return <RowActions label={`车辆 ${vehicle.plateNo}`} edit={<VehicleDialog vehicle={vehicle} trigger={editIcon} />} onDelete={() => deleteVehicle(vehicle.id)} />;
}

// ───────────── 司机 ─────────────

export type DriverValues = { id: string; name: string; phone: string; licenseNo: string | null; status: string; userId: string | null };

export function DriverDialog({ driver, users, trigger }: { driver?: DriverValues; users: { id: string; name: string; email: string }[]; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const init = () => ({
    name: driver?.name ?? "",
    phone: driver?.phone ?? "",
    licenseNo: driver?.licenseNo ?? "",
    status: driver?.status ?? "AVAILABLE",
    userId: driver?.userId ?? "",
  });
  const [v, setV] = useState(init);
  const { run, pending } = useAction();
  return (
    <FormDialog
      title={driver ? `编辑司机 ${driver.name}` : "新建司机"}
      trigger={trigger}
      open={open}
      setOpen={setOpen}
      pending={pending}
      onOpen={() => setV(init())}
      onSubmit={() =>
        run(() => saveDriver({ id: driver?.id, ...v, userId: v.userId || null }), {
          success: driver ? "司机已保存" : "司机已创建",
          onSuccess: () => setOpen(false),
        })
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="姓名" required>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </Field>
        <Field label="电话" required>
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </Field>
        <Field label="驾驶证号">
          <Input value={v.licenseNo} onChange={(e) => setV({ ...v, licenseNo: e.target.value })} />
        </Field>
        <Field label="状态" required>
          <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {Object.entries(DRIVER_STATUS).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="关联系统账号" className="col-span-2" hint="关联后，司机可登录系统查看并操作自己的运输任务（发车、上报位置、签收）">
          <Select value={v.userId} onChange={(e) => setV({ ...v, userId: e.target.value })}>
            <option value="">不关联</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{u.email}）
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </FormDialog>
  );
}

export function DriverRowActions({ driver, users }: { driver: DriverValues; users: { id: string; name: string; email: string }[] }) {
  return (
    <RowActions label={`司机 ${driver.name}`} edit={<DriverDialog driver={driver} users={users} trigger={editIcon} />} onDelete={() => deleteDriver(driver.id)} />
  );
}

// ───────────── 线路 ─────────────

export type RouteValues = {
  id: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  estimatedHours: number;
  stops: string[];
};

export function RouteDialog({ route, trigger }: { route?: RouteValues; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const init = () => ({
    name: route?.name ?? "",
    origin: route?.origin ?? "",
    destination: route?.destination ?? "",
    distanceKm: route ? String(route.distanceKm) : "",
    estimatedHours: route ? String(route.estimatedHours) : "",
    stops: route?.stops ?? [],
  });
  const [v, setV] = useState(init);
  const [stop, setStop] = useState("");
  const { run, pending } = useAction();
  const move = (i: number, d: number) => {
    const s = [...v.stops];
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    setV({ ...v, stops: s });
  };
  const addStop = () => {
    const t = stop.trim();
    if (!t) return;
    setV({ ...v, stops: [...v.stops, t] });
    setStop("");
  };
  return (
    <FormDialog
      title={route ? `编辑线路 ${route.name}` : "新建线路"}
      trigger={trigger}
      open={open}
      setOpen={setOpen}
      pending={pending}
      onOpen={() => {
        setV(init());
        setStop("");
      }}
      onSubmit={() =>
        run(() => saveRoute({ id: route?.id, ...v, name: v.name || `${v.origin} → ${v.destination}` }), {
          success: route ? "线路已保存" : "线路已创建",
          onSuccess: () => setOpen(false),
        })
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="起点" required>
          <Input value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value })} autoFocus />
        </Field>
        <Field label="终点" required>
          <Input value={v.destination} onChange={(e) => setV({ ...v, destination: e.target.value })} />
        </Field>
        <Field label="线路名称" className="col-span-2" hint="留空则使用「起点 → 终点」">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={v.origin && v.destination ? `${v.origin} → ${v.destination}` : ""} />
        </Field>
        <Field label="里程（km）">
          <Input type="number" min={0} value={v.distanceKm} onChange={(e) => setV({ ...v, distanceKm: e.target.value })} />
        </Field>
        <Field label="预计时长（小时）">
          <Input type="number" min={0} step="0.5" value={v.estimatedHours} onChange={(e) => setV({ ...v, estimatedHours: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-xs font-medium text-ink-2">途经点（按顺序）</div>
        <div className="space-y-1">
          {v.stops.length === 0 && <div className="text-[13px] text-ink-3">暂无途经点</div>}
          {v.stops.map((s, i) => (
            <div key={`${s}-${i}`} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-[13px]">
              <span className="flex size-5 items-center justify-center rounded-full bg-hover text-[11px] text-ink-2">{i + 1}</span>
              <span className="flex-1 truncate">{s}</span>
              <IconButton onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移">
                <ArrowUp className="size-3.5" />
              </IconButton>
              <IconButton onClick={() => move(i, 1)} disabled={i === v.stops.length - 1} aria-label="下移">
                <ArrowDown className="size-3.5" />
              </IconButton>
              <IconButton onClick={() => setV({ ...v, stops: v.stops.filter((_, k) => k !== i) })} aria-label="移除">
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addStop();
              }
            }}
            placeholder="输入途经点后回车添加"
            className="h-7"
          />
          <Button size="sm" onClick={addStop}>
            <Plus className="size-3.5" />
            添加
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

export function RouteRowActions({ route }: { route: RouteValues }) {
  return <RowActions label={`线路 ${route.name}`} edit={<RouteDialog route={route} trigger={editIcon} />} onDelete={() => deleteRoute(route.id)} />;
}
