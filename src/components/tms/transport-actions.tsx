"use client";

import { useState, type ReactNode } from "react";
import { addHours, format } from "date-fns";
import { CircleCheck, MapPin, Navigation, Route as RouteIcon, Send, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { cancelOrder, departOrder, dispatchTransport, reportPosition, signOrder } from "@/app/(app)/tms/actions";
import { DRIVER_STATUS, VEHICLE_STATUS } from "@/lib/labels";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatHours } from "@/lib/tms/stops";
import type { DispatchOptions } from "@/lib/tms/queries";
import { cn } from "@/lib/utils";

export type DispatchOrder = {
  id: string;
  no: string;
  status: string;
  weight: number;
  origin: string;
  destination: string;
  vehicleId: string | null;
  driverId: string | null;
  routeId: string | null;
  plannedAt: string | null;
  freightCost: number;
};

function Choice({
  selected,
  disabled,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors",
        selected ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
        disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
      )}
    >
      <span className={cn("size-3.5 shrink-0 rounded-full border", selected ? "border-[4px] border-accent" : "border-line-strong")} />
      {children}
    </button>
  );
}

export function AssignDialog({ order, options, trigger }: { order: DispatchOrder; options: DispatchOptions; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [freight, setFreight] = useState("");
  const { run, pending } = useAction();

  const vehicleDisabled = (v: DispatchOptions["vehicles"][number]) =>
    (v.status !== "AVAILABLE" && v.id !== order.vehicleId) || v.capacity < order.weight;
  const driverDisabled = (d: DispatchOptions["drivers"][number]) => d.status === "OFF";

  const init = () => {
    const v = options.vehicles.find((x) => x.id === order.vehicleId) ?? options.vehicles.find((x) => !vehicleDisabled(x) && x.assignedCount === 0);
    const d =
      options.drivers.find((x) => x.id === order.driverId) ??
      options.drivers.find((x) => x.status === "AVAILABLE" && x.assignedCount === 0) ??
      options.drivers.find((x) => !driverDisabled(x));
    const matched = options.routes.find((r) => r.id === order.routeId);
    setVehicleId(v?.id ?? "");
    setDriverId(d?.id ?? "");
    setRouteId(matched?.id ?? "");
    const base = order.plannedAt ? new Date(order.plannedAt) : addHours(new Date(), 1);
    if (!order.plannedAt) base.setMinutes(0, 0, 0);
    setPlannedAt(format(base, "yyyy-MM-dd'T'HH:mm"));
    setFreight(order.freightCost ? String(order.freightCost) : "");
  };

  const route = options.routes.find((r) => r.id === routeId);
  const eta = route && plannedAt && route.estimatedHours ? addHours(new Date(plannedAt), route.estimatedHours) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) init();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="lg"
        title={`${order.status === "ASSIGNED" ? "重新调度" : "调度"} ${order.no}`}
        description={
          <>
            {order.origin} → {order.destination} · 货重 {formatNumber(order.weight, 2)} kg
          </>
        }
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    dispatchTransport({
                      orderId: order.id,
                      vehicleId,
                      driverId,
                      routeId: routeId || null,
                      plannedAt,
                      freightCost: freight || 0,
                    }),
                  { success: "调度成功，已通知司机", onSuccess: () => setOpen(false) },
                )
              }
            >
              确认调度
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 text-xs font-medium text-ink-2">
              车辆 <span className="text-danger">*</span>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {options.vehicles.map((v) => {
                const disabled = vehicleDisabled(v);
                const over = v.capacity < order.weight;
                return (
                  <Choice key={v.id} selected={vehicleId === v.id} disabled={disabled} onSelect={() => setVehicleId(v.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{v.plateNo}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {v.type} · 载重 {formatNumber(v.capacity)} kg{over ? "（载重不足）" : ""}
                      </span>
                    </span>
                    {v.assignedCount > 0 && v.status === "AVAILABLE" && <Badge color="yellow">已排 {v.assignedCount}</Badge>}
                    <Badge color={VEHICLE_STATUS[v.status as keyof typeof VEHICLE_STATUS]?.color ?? "gray"}>
                      {VEHICLE_STATUS[v.status as keyof typeof VEHICLE_STATUS]?.label ?? v.status}
                    </Badge>
                  </Choice>
                );
              })}
              {options.vehicles.length === 0 && <div className="text-[13px] text-ink-3">还没有车辆</div>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-2">
              司机 <span className="text-danger">*</span>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {options.drivers.map((d) => (
                <Choice key={d.id} selected={driverId === d.id} disabled={driverDisabled(d)} onSelect={() => setDriverId(d.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{d.name}</span>
                    <span className="block text-xs text-ink-3">{d.phone}</span>
                  </span>
                  {d.assignedCount > 0 && <Badge color="yellow">已排 {d.assignedCount}</Badge>}
                  <Badge color={DRIVER_STATUS[d.status as keyof typeof DRIVER_STATUS]?.color ?? "gray"}>
                    {DRIVER_STATUS[d.status as keyof typeof DRIVER_STATUS]?.label ?? d.status}
                  </Badge>
                </Choice>
              ))}
              {options.drivers.length === 0 && <div className="text-[13px] text-ink-3">还没有司机</div>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Field label="线路（可选）">
            <Select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">不指定线路</option>
              {options.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="计划发车时间">
            <Input type="datetime-local" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
          </Field>
          <Field
            label="运费（元）"
            hint={
              route?.distanceKm ? (
                <button type="button" className="text-accent hover:underline" onClick={() => setFreight(String(Math.round(route.distanceKm * 4)))}>
                  按 4 元/公里估算：¥{formatNumber(Math.round(route.distanceKm * 4))}
                </button>
              ) : undefined
            }
          >
            <Input type="number" min={0} step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        {route && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-sidebar px-3 py-2 text-[13px] text-ink-2">
            <span className="flex items-center gap-1">
              <RouteIcon className="size-3.5" />
              {route.origin} → {route.stops.length ? `${route.stops.join(" → ")} → ` : ""}
              {route.destination}
            </span>
            <span>里程 {formatNumber(route.distanceKm)} km</span>
            <span>预计时长 {formatHours(route.estimatedHours)}</span>
            {eta && <span className="text-ink">预计到达 {formatDateTime(eta)}</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SimpleDialog({
  trigger,
  title,
  description,
  confirmText,
  onOpen,
  onSubmit,
  pending,
  children,
  open,
  setOpen,
  danger,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmText: string;
  onOpen?: () => void;
  onSubmit: () => void;
  pending: boolean;
  children: ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) onOpen?.();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={title}
        description={description}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant={danger ? "danger" : "primary"} loading={pending} onClick={onSubmit}>
              {confirmText}
            </Button>
          </>
        }
      >
        <div className="space-y-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function DepartButton({ orderId, origin, size = "sm" }: { orderId: string; origin: string; size?: "xs" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(origin);
  const { run, pending } = useAction();
  return (
    <SimpleDialog
      open={open}
      setOpen={setOpen}
      pending={pending}
      title="确认发车"
      description="发车后车辆与司机状态变为运输中，运输单进入在途跟踪。"
      confirmText="确认发车"
      onOpen={() => setLocation(origin)}
      onSubmit={() => run(() => departOrder({ orderId, location }), { success: "已发车", onSuccess: () => setOpen(false) })}
      trigger={
        <Button variant="primary" size={size}>
          <Send className="size-3.5" />
          发车
        </Button>
      }
    >
      <Field label="发车地点">
        <Input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
    </SimpleDialog>
  );
}

export function ReportButton({ orderId, size = "sm" }: { orderId: string; size?: "xs" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  return (
    <SimpleDialog
      open={open}
      setOpen={setOpen}
      pending={pending}
      title="上报在途位置"
      confirmText="上报"
      onOpen={() => {
        setLocation("");
        setNote("");
      }}
      onSubmit={() => run(() => reportPosition({ orderId, location, note }), { success: "位置已上报", onSuccess: () => setOpen(false) })}
      trigger={
        <Button size={size}>
          <MapPin className="size-3.5" />
          上报位置
        </Button>
      }
    >
      <Field label="当前位置" required>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例如：G60 沪昆高速嘉兴服务区" autoFocus />
      </Field>
      <Field label="备注">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：路况良好，预计 2 小时后到达" />
      </Field>
    </SimpleDialog>
  );
}

export function DeliverButton({ orderId, size = "sm" }: { orderId: string; size?: "xs" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  return (
    <SimpleDialog
      open={open}
      setOpen={setOpen}
      pending={pending}
      title="确认签收"
      description="签收后释放车辆和司机；关联销售订单变为已签收，并自动生成应收账款。"
      confirmText="确认签收"
      onOpen={() => setNote("")}
      onSubmit={() => run(() => signOrder({ orderId, note }), { success: "已签收", onSuccess: () => setOpen(false) })}
      trigger={
        <Button variant="primary" size={size}>
          <CircleCheck className="size-3.5" />
          签收
        </Button>
      }
    >
      <Field label="签收备注">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：收货人本人签收，货物完好" autoFocus />
      </Field>
    </SimpleDialog>
  );
}

export function CancelTransportButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  return (
    <SimpleDialog
      open={open}
      setOpen={setOpen}
      pending={pending}
      danger
      title="取消运输单"
      description="运输中或已签收的运输单不能取消。"
      confirmText="取消运输单"
      onOpen={() => setReason("")}
      onSubmit={() => run(() => cancelOrder({ orderId, reason }), { success: "运输单已取消", onSuccess: () => setOpen(false) })}
      trigger={
        <Button variant="ghost">
          <XCircle className="size-3.5" />
          取消
        </Button>
      }
    >
      <Field label="取消原因">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：客户要求延期发货" autoFocus />
      </Field>
    </SimpleDialog>
  );
}

/** 运输单详情页操作区 */
export function TransportActions({
  order,
  canDispatch,
  canOperate,
  options,
}: {
  order: DispatchOrder;
  canDispatch: boolean;
  canOperate: boolean;
  options: DispatchOptions | null;
}) {
  const s = order.status;
  return (
    <div className="flex items-center gap-1.5">
      {canDispatch && (s === "PENDING" || s === "ASSIGNED") && <CancelTransportButton orderId={order.id} />}
      {canDispatch && options && (s === "PENDING" || s === "ASSIGNED") && (
        <AssignDialog
          order={order}
          options={options}
          trigger={
            <Button variant={s === "PENDING" ? "primary" : "default"}>
              <Navigation className="size-3.5" />
              {s === "PENDING" ? "调度" : "重新调度"}
            </Button>
          }
        />
      )}
      {canOperate && s === "ASSIGNED" && <DepartButton orderId={order.id} origin={order.origin} />}
      {canOperate && s === "IN_TRANSIT" && (
        <>
          <ReportButton orderId={order.id} />
          <DeliverButton orderId={order.id} />
        </>
      )}
    </div>
  );
}
