import Link from "next/link";
import { startOfDay } from "date-fns";
import { CircleCheck, Clock, Navigation, Truck, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { TRANSPORT_STATUS } from "@/lib/labels";
import { getDispatchOptions, getDriverByUser } from "@/lib/tms/queries";
import { Dot } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Page, PageHeader, Section, StatCard, TopBar } from "@/components/ui/page";
import { AssignDialog, DeliverButton, DepartButton, ReportButton } from "@/components/tms/transport-actions";
import { TransportCard, boardOrderSelect } from "@/components/tms/transport-card";

export default async function DispatchBoardPage() {
  const user = await requireUser();
  const canDispatch = can(user, "tms:edit");
  const today = startOfDay(new Date());
  const [me, pending, assigned, inTransit, delivered, deliveredToday, idleVehicles, idleDrivers, options] = await Promise.all([
    getDriverByUser(user.id),
    db.transportOrder.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { ...boardOrderSelect, vehicleId: true, driverId: true, routeId: true, freightCost: true },
    }),
    db.transportOrder.findMany({ where: { status: "ASSIGNED" }, orderBy: [{ plannedAt: "asc" }], select: boardOrderSelect }),
    db.transportOrder.findMany({ where: { status: "IN_TRANSIT" }, orderBy: { departedAt: "desc" }, select: boardOrderSelect }),
    db.transportOrder.findMany({ where: { status: "DELIVERED" }, orderBy: { deliveredAt: "desc" }, take: 8, select: boardOrderSelect }),
    db.transportOrder.count({ where: { status: "DELIVERED", deliveredAt: { gte: today } } }),
    db.vehicle.count({ where: { status: "AVAILABLE" } }),
    db.driver.count({ where: { status: "AVAILABLE" } }),
    canDispatch ? getDispatchOptions() : Promise.resolve(null),
  ]);
  const myTasks = me
    ? await db.transportOrder.findMany({
        where: { driverId: me.id, status: { in: ["ASSIGNED", "IN_TRANSIT"] } },
        orderBy: [{ status: "desc" }, { plannedAt: "asc" }],
        select: boardOrderSelect,
      })
    : [];

  const columns = [
    { key: "PENDING" as const, title: "待调度", orders: pending },
    { key: "ASSIGNED" as const, title: "已调度", orders: assigned },
    { key: "IN_TRANSIT" as const, title: "运输中", orders: inTransit },
    { key: "DELIVERED" as const, title: "已签收（最近）", orders: delivered },
  ];

  return (
    <>
      <TopBar
        crumbs={[{ label: "TMS 运输", href: "/tms" }, { label: "调度中心" }]}
        actions={
          <LinkButton href="/tms/orders" variant="ghost">
            全部运输单
          </LinkButton>
        }
      />
      <Page wide>
        <PageHeader icon="🚚" title="调度中心" description="待调度运输单一键派车，实时查看在途与签收情况" />

        {me && (
          <Section title={`我的运输任务（${myTasks.length}）`} className="mt-0 mb-8">
            {myTasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-2">
                {me.name}，你当前没有待执行的运输任务 🎉
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {myTasks.map((o) => (
                  <TransportCard
                    key={o.id}
                    order={o}
                    showStatus
                    action={
                      o.status === "ASSIGNED" ? (
                        <DepartButton orderId={o.id} origin={o.origin} size="xs" />
                      ) : (
                        <span className="flex items-center gap-1">
                          <ReportButton orderId={o.id} size="xs" />
                          <DeliverButton orderId={o.id} size="xs" />
                        </span>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="待调度" value={pending.length} icon={<Clock />} href="/tms/orders?status=PENDING" hint="等待分配车辆与司机" />
          <StatCard label="运输中" value={inTransit.length} icon={<Truck />} href="/tms/orders?status=IN_TRANSIT" hint={`已调度待发车 ${assigned.length}`} />
          <StatCard label="今日签收" value={deliveredToday} icon={<CircleCheck />} href="/tms/orders?status=DELIVERED" />
          <StatCard
            label="空闲车辆 / 司机"
            value={
              <span>
                {idleVehicles} <span className="text-base font-normal text-ink-3">/</span> {idleDrivers}
              </span>
            }
            icon={<UserRound />}
            href="/tms/vehicles"
            hint="可立即派车的资源"
          />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((col) => (
            <div key={col.key} className="flex min-h-40 flex-col rounded-lg bg-sidebar p-2">
              <div className="mb-2 flex items-center gap-2 px-1 pt-0.5 text-[13px] font-medium text-ink">
                <Dot color={TRANSPORT_STATUS[col.key].color} />
                {col.title}
                <span className="text-ink-3 tabular-nums">{col.orders.length}</span>
                <Link href={`/tms/orders?status=${col.key}`} className="ml-auto text-xs font-normal text-ink-3 hover:text-ink">
                  查看全部
                </Link>
              </div>
              <div className="space-y-2">
                {col.orders.length === 0 && <div className="py-6 text-center text-xs text-ink-3">暂无运输单</div>}
                {col.key === "PENDING"
                  ? pending.map((o) => (
                      <TransportCard
                        key={o.id}
                        order={o}
                        action={
                          canDispatch && options ? (
                            <AssignDialog
                              order={{
                                id: o.id,
                                no: o.no,
                                status: o.status,
                                weight: o.weight,
                                origin: o.origin,
                                destination: o.destination,
                                vehicleId: o.vehicleId,
                                driverId: o.driverId,
                                routeId: o.routeId,
                                plannedAt: o.plannedAt?.toISOString() ?? null,
                                freightCost: o.freightCost,
                              }}
                              options={options}
                              trigger={
                                <Button size="xs" variant="primary">
                                  <Navigation className="size-3" />
                                  调度
                                </Button>
                              }
                            />
                          ) : undefined
                        }
                      />
                    ))
                  : col.orders.map((o) => <TransportCard key={o.id} order={o} />)}
              </div>
            </div>
          ))}
        </div>
      </Page>
    </>
  );
}
