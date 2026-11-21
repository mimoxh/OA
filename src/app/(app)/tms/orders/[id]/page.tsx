import Link from "next/link";
import { notFound } from "next/navigation";
import { addHours } from "date-fns";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { DRIVER_STATUS, OUTBOUND_STATUS, SALES_STATUS, TRANSPORT_STATUS, VEHICLE_STATUS } from "@/lib/labels";
import { getDispatchOptions } from "@/lib/tms/queries";
import { formatHours, parseStops } from "@/lib/tms/stops";
import { StatusBadge } from "@/components/ui/badge";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { RouteHeader } from "@/components/tms/route-header";
import { TransportTimeline } from "@/components/tms/timeline";
import { TransportActions } from "@/components/tms/transport-actions";

export default async function TransportDetailPage({ params }: PageProps<"/tms/orders/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canDispatch = can(user, "tms:edit");
  const order = await db.transportOrder.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      outboundOrder: { select: { id: true, no: true, status: true } },
      salesOrder: { select: { id: true, no: true, status: true, totalAmount: true } },
      vehicle: true,
      driver: { include: { user: { select: { name: true } } } },
      route: true,
      events: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, avatarColor: true } } } },
    },
  });
  if (!order) notFound();
  const options = canDispatch ? await getDispatchOptions() : null;
  const isMine = !!order.driver?.userId && order.driver.userId === user.id;
  const canOperate = canDispatch || isMine;
  const stops = order.route ? parseStops(order.route.stops) : [];
  const tracking = order.events.filter((e) => e.status === "TRACKING");
  const latest = order.events.find((e) => e.location)?.location ?? null;
  const eta = order.plannedAt && order.route?.estimatedHours ? addHours(order.plannedAt, order.route.estimatedHours) : null;
  const active = order.status === "ASSIGNED" || order.status === "IN_TRANSIT";

  return (
    <>
      <TopBar
        crumbs={[{ label: "TMS 运输", href: "/tms" }, { label: "运输单", href: "/tms/orders" }, { label: order.no }]}
        actions={
          <TransportActions
            canDispatch={canDispatch}
            canOperate={canOperate}
            options={options}
            order={{
              id: order.id,
              no: order.no,
              status: order.status,
              weight: order.weight,
              origin: order.origin,
              destination: order.destination,
              vehicleId: order.vehicleId,
              driverId: order.driverId,
              routeId: order.routeId,
              plannedAt: order.plannedAt?.toISOString() ?? null,
              freightCost: order.freightCost,
            }}
          />
        }
      />
      <Page>
        <PageHeader
          icon="🚚"
          title={order.no}
          description={order.remark ?? undefined}
          meta={
            <>
              <StatusBadge map={TRANSPORT_STATUS} value={order.status} />
              {isMine && <span className="rounded bg-tag-blue px-1.5 py-0.5 text-xs text-tag-blue-ink">指派给我的任务</span>}
            </>
          }
        />
        <RouteHeader
          origin={order.origin}
          destination={order.destination}
          stops={stops}
          status={order.status}
          trackingCount={tracking.length}
          latestLocation={latest}
        />
        {!canOperate && active && (
          <p className="mt-2 text-xs text-ink-3">该运输单未指派给你，只能查看；发车、上报位置、签收由指派司机或调度员操作。</p>
        )}

        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[1fr_340px]">
          <div>
            <Section title="运输信息">
              <Properties>
                <Property label="客户">
                  {order.customer ? (
                    <Link href={`/crm/customers/${order.customer.id}`} className="text-accent hover:underline">
                      {order.customer.name}
                    </Link>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Property>
                <Property label="收货人">
                  {order.consignee ?? "—"}
                  {order.consigneePhone && <span className="ml-2 text-ink-2">{order.consigneePhone}</span>}
                </Property>
                <Property label="货物重量">{formatNumber(order.weight, 2)} kg</Property>
                <Property label="车辆">
                  {order.vehicle ? (
                    <span className="flex items-center gap-2">
                      <Link href="/tms/vehicles" className="hover:underline">
                        {order.vehicle.plateNo}
                      </Link>
                      <span className="text-ink-2">
                        {order.vehicle.type} · 载重 {formatNumber(order.vehicle.capacity)} kg
                      </span>
                      <StatusBadge map={VEHICLE_STATUS} value={order.vehicle.status} />
                    </span>
                  ) : (
                    <span className="text-ink-3">未调度</span>
                  )}
                </Property>
                <Property label="司机">
                  {order.driver ? (
                    <span className="flex items-center gap-2">
                      <Link href="/tms/drivers" className="hover:underline">
                        {order.driver.name}
                      </Link>
                      <span className="text-ink-2">{order.driver.phone}</span>
                      <StatusBadge map={DRIVER_STATUS} value={order.driver.status} />
                    </span>
                  ) : (
                    <span className="text-ink-3">未调度</span>
                  )}
                </Property>
                <Property label="线路">
                  {order.route ? (
                    <span>
                      <Link href="/tms/routes" className="hover:underline">
                        {order.route.name}
                      </Link>
                      <span className="ml-2 text-ink-2">
                        {formatNumber(order.route.distanceKm)} km · 预计 {formatHours(order.route.estimatedHours)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink-3">未指定</span>
                  )}
                </Property>
                <Property label="计划发车">{formatDateTime(order.plannedAt)}</Property>
                {eta && <Property label="预计到达">{formatDateTime(eta)}</Property>}
                <Property label="实际发车">{formatDateTime(order.departedAt)}</Property>
                <Property label="签收时间">{formatDateTime(order.deliveredAt)}</Property>
                <Property label="运费">{order.freightCost ? formatMoney(order.freightCost) : "—"}</Property>
              </Properties>
            </Section>
            <Section title="关联单据">
              <Properties>
                <Property label="出库单">
                  {order.outboundOrder ? (
                    <span className="flex items-center gap-2">
                      <Link href={`/wms/outbound/${order.outboundOrder.id}`} className="text-accent hover:underline">
                        {order.outboundOrder.no}
                      </Link>
                      <StatusBadge map={OUTBOUND_STATUS} value={order.outboundOrder.status} />
                    </span>
                  ) : (
                    <span className="text-ink-3">无（手工运输单）</span>
                  )}
                </Property>
                <Property label="销售订单">
                  {order.salesOrder ? (
                    <span className="flex items-center gap-2">
                      <Link href={`/erp/sales/${order.salesOrder.id}`} className="text-accent hover:underline">
                        {order.salesOrder.no}
                      </Link>
                      <StatusBadge map={SALES_STATUS} value={order.salesOrder.status} />
                      <span className="text-ink-2">{formatMoney(order.salesOrder.totalAmount)}</span>
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Property>
                <Property label="创建时间">{formatDateTime(order.createdAt)}</Property>
              </Properties>
            </Section>
          </div>
          <Section title={`跟踪时间线（${order.events.length}）`}>
            <div className="rounded-lg border border-line bg-white p-4">
              <TransportTimeline events={order.events} />
            </div>
          </Section>
        </div>
      </Page>
    </>
  );
}
