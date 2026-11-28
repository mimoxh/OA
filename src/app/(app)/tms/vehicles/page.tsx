import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatNumber } from "@/lib/format";
import { TRANSPORT_STATUS, VEHICLE_STATUS } from "@/lib/labels";
import { str } from "@/lib/wms/params";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { VehicleDialog, VehicleRowActions } from "@/components/tms/master-forms";
import { MobileCard, MobileField, MobileList } from "@/components/mobile/mobile-list";

export default async function VehiclesPage({ searchParams }: PageProps<"/tms/vehicles">) {
  const user = await requireUser();
  const canEdit = can(user, "tms:edit");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const [vehicles, all] = await Promise.all([
    db.vehicle.findMany({
      where: {
        ...(q ? { OR: [{ plateNo: { contains: q } }, { type: { contains: q } }] } : {}),
        ...(status && status in VEHICLE_STATUS ? { status: status as keyof typeof VEHICLE_STATUS } : {}),
      },
      orderBy: { plateNo: "asc" },
      include: {
        _count: { select: { orders: true } },
        orders: {
          where: { status: { in: ["ASSIGNED", "IN_TRANSIT"] } },
          orderBy: { plannedAt: "asc" },
          select: { id: true, no: true, status: true, destination: true, driver: { select: { name: true } } },
        },
      },
    }),
    db.vehicle.groupBy({ by: ["status"], _count: true, _sum: { capacity: true } }),
  ]);
  const countOf = (s: string) => all.find((c) => c.status === s)?._count ?? 0;
  const totalCapacity = all.reduce((s, c) => s + (c._sum.capacity ?? 0), 0);

  return (
    <>
      <TopBar
        crumbs={[{ label: "TMS 运输", href: "/tms" }, { label: "车辆" }]}
        actions={
          canEdit ? (
            <VehicleDialog
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建车辆
                </Button>
              }
            />
          ) : null
        }
      />
      <Page>
        <PageHeader
          icon="🚛"
          title="车辆"
          description="车辆档案与状态；发车后自动变为运输中，签收后恢复空闲"
          meta={
            <>
              <span className="text-ink-2">
                车辆 <span className="font-medium tabular-nums text-ink">{all.reduce((s, c) => s + c._count, 0)}</span>
              </span>
              <span className="text-ink-2">
                总运力 <span className="font-medium tabular-nums text-ink">{formatNumber(totalCapacity / 1000, 1)} 吨</span>
              </span>
            </>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterPills options={Object.entries(VEHICLE_STATUS).map(([value, m]) => ({ value, label: m.label, count: countOf(value) }))} />
          <div className="flex-1" />
          <SearchInput placeholder="车牌 / 车型" />
        </div>
        <MobileList empty="暂无车辆">
          {vehicles.map((v) => (
            <MobileCard
              key={v.id}
              title={v.plateNo}
              badge={
                <>
                  <StatusBadge map={VEHICLE_STATUS} value={v.status} />
                  {canEdit && (
                    <VehicleRowActions
                      vehicle={{ id: v.id, plateNo: v.plateNo, type: v.type, capacity: v.capacity, status: v.status, remark: v.remark }}
                    />
                  )}
                </>
              }
              subtitle={[v.type, v.remark].filter(Boolean).join(" · ")}
              meta={<MobileField label="历史运输单">{v._count.orders}</MobileField>}
              aside={`${formatNumber(v.capacity)} kg`}
            >
              {v.orders.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-line pt-2">
                  {v.orders.map((o) => (
                    <Link key={o.id} href={`/tms/orders/${o.id}`} className="flex min-w-0 items-center gap-1.5 text-[13px]">
                      <StatusBadge map={TRANSPORT_STATUS} value={o.status} />
                      <span className="shrink-0 tabular-nums text-accent">{o.no}</span>
                      <span className="min-w-0 truncate text-ink-2">→ {o.destination}</span>
                    </Link>
                  ))}
                </div>
              )}
            </MobileCard>
          ))}
        </MobileList>
        <Table className="max-md:hidden">
          <THead>
            <TR>
              <TH>车牌号</TH>
              <TH>车型</TH>
              <TH className="text-right">载重</TH>
              <TH>状态</TH>
              <TH>当前任务</TH>
              <TH className="text-right">历史运输单</TH>
              <TH>备注</TH>
              {canEdit && <TH className="w-16" />}
            </TR>
          </THead>
          <TBody>
            {vehicles.length === 0 && <TEmpty colSpan={canEdit ? 8 : 7}>暂无车辆</TEmpty>}
            {vehicles.map((v) => (
              <TR key={v.id}>
                <TD className="font-medium">{v.plateNo}</TD>
                <TD>{v.type}</TD>
                <TD className="text-right tabular-nums">{formatNumber(v.capacity)} kg</TD>
                <TD>
                  <StatusBadge map={VEHICLE_STATUS} value={v.status} />
                </TD>
                <TD>
                  {v.orders.length === 0 ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <div className="space-y-0.5">
                      {v.orders.map((o) => (
                        <Link key={o.id} href={`/tms/orders/${o.id}`} className="flex items-center gap-1.5 text-[13px] hover:underline">
                          <StatusBadge map={TRANSPORT_STATUS} value={o.status} />
                          <span className="tabular-nums text-accent">{o.no}</span>
                          <span className="max-w-40 truncate text-ink-2">→ {o.destination}</span>
                          {o.driver && <span className="text-xs text-ink-3">{o.driver.name}</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </TD>
                <TD className="text-right tabular-nums">{v._count.orders}</TD>
                <TD className="max-w-40 truncate text-ink-2">{v.remark ?? "—"}</TD>
                {canEdit && (
                  <TD>
                    <VehicleRowActions
                      vehicle={{ id: v.id, plateNo: v.plateNo, type: v.type, capacity: v.capacity, status: v.status, remark: v.remark }}
                    />
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Page>
    </>
  );
}
