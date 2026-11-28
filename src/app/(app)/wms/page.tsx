import Link from "next/link";
import { startOfDay } from "date-fns";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, PackageOpen } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { INBOUND_STATUS, INBOUND_TYPE, OUTBOUND_STATUS, OUTBOUND_TYPE } from "@/lib/labels";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, EmptyState, Page, PageHeader, Section, StatCard, TopBar } from "@/components/ui/page";
import { MovementTable, movementInclude } from "@/components/wms/movement-table";
import { ModuleEntries } from "@/components/mobile/module-entries";

const BAR_COLORS = ["#9065b0", "#2383e2", "#448361", "#cb912f", "#d44c47", "#337ea9"];

export default async function WmsOverviewPage() {
  const user = await requireUser();
  const today = startOfDay(new Date());
  const [inventories, products, warehouses, pendingIn, pendingOut, todayMoves, recent] = await Promise.all([
    db.inventory.findMany({ include: { product: { select: { cost: true } } } }),
    db.product.findMany({ where: { active: true }, select: { id: true, safetyStock: true } }),
    db.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, name: true, code: true } }),
    db.inboundOrder.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { warehouse: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    db.outboundOrder.findMany({
      where: { status: { in: ["PENDING", "PICKING"] } },
      orderBy: { createdAt: "desc" },
      include: { warehouse: { select: { name: true } }, salesOrder: { select: { customer: { select: { name: true } } } } },
    }),
    db.stockMovement.groupBy({ by: ["type"], where: { createdAt: { gte: today } }, _sum: { quantity: true } }),
    db.stockMovement.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: movementInclude }),
  ]);

  const totalQty = inventories.reduce((s, i) => s + i.quantity, 0);
  const totalValue = inventories.reduce((s, i) => s + i.quantity * i.product.cost, 0);
  const totalReserved = inventories.reduce((s, i) => s + i.reservedQty, 0);
  const byProduct = new Map<string, number>();
  for (const i of inventories) byProduct.set(i.productId, (byProduct.get(i.productId) ?? 0) + i.quantity);
  const lowCount = products.filter((p) => (byProduct.get(p.id) ?? 0) < p.safetyStock).length;
  const todayIn = todayMoves.find((m) => m.type === "IN")?._sum.quantity ?? 0;
  const todayOut = Math.abs(todayMoves.find((m) => m.type === "OUT")?._sum.quantity ?? 0);

  const perWarehouse = warehouses.map((w, idx) => {
    const rows = inventories.filter((i) => i.warehouseId === w.id);
    return {
      ...w,
      color: BAR_COLORS[idx % BAR_COLORS.length],
      qty: rows.reduce((s, i) => s + i.quantity, 0),
      value: rows.reduce((s, i) => s + i.quantity * i.product.cost, 0),
      skus: rows.filter((i) => i.quantity > 0).length,
    };
  });

  return (
    <>
      <TopBar
        mobileTitle="WMS 仓储"
        crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "仓储概览" }]}
        actions={
          <>
            <LinkButton href="/wms/inbound" variant="ghost">
              入库单
            </LinkButton>
            <LinkButton href="/wms/outbound" variant="ghost">
              出库单
            </LinkButton>
          </>
        }
      />
      <Page>
        <PageHeader icon="🏭" title="仓储概览" description="库存总览、待处理出入库与最新库存动态" />
        <ModuleEntries moduleKey="wms" permissions={user.permissions} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="总库存量"
            value={formatNumber(totalQty)}
            hint={`已预占 ${formatNumber(totalReserved)}，可用 ${formatNumber(totalQty - totalReserved)}`}
            icon={<Boxes />}
            href="/wms/inventory"
          />
          <StatCard label="库存金额" value={formatMoney(totalValue)} hint="按产品当前成本计算" icon={<PackageOpen />} href="/wms/inventory" />
          <StatCard
            label="待收货入库单"
            value={pendingIn.length}
            hint={`今日入库 ${formatNumber(todayIn)} 件`}
            icon={<ArrowDownToLine />}
            href="/wms/inbound?status=PENDING"
          />
          <StatCard
            label="待发货出库单"
            value={pendingOut.length}
            hint={`今日出库 ${formatNumber(todayOut)} 件`}
            icon={<ArrowUpFromLine />}
            href="/wms/outbound?status=open"
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Link
            href="/wms/inventory?low=1"
            className="flex items-center gap-3 rounded-lg border border-line bg-white p-4 transition-colors hover:bg-sidebar"
          >
            <span className={`flex size-9 items-center justify-center rounded-md ${lowCount ? "bg-tag-red text-danger" : "bg-tag-green text-[#448361]"}`}>
              <AlertTriangle className="size-4" />
            </span>
            <div>
              <div className="text-[13px] text-ink-2">低于安全库存</div>
              <div className="text-xl font-semibold tabular-nums">
                {lowCount} <span className="text-sm font-normal text-ink-3">个产品</span>
              </div>
              <div className="text-xs text-ink-3">按全部仓库合计库存判断</div>
            </div>
          </Link>
          <Card className="p-4 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between text-[13px] text-ink-2">
              <span>各仓库库存占比</span>
              <Link href="/wms/warehouses" className="text-xs text-ink-3 hover:text-ink">
                仓库与库位 →
              </Link>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-hover">
              {perWarehouse.map((w) =>
                totalQty > 0 && w.qty > 0 ? (
                  <span key={w.id} style={{ width: `${(w.qty / totalQty) * 100}%`, backgroundColor: w.color }} title={`${w.name} ${w.qty}`} />
                ) : null,
              )}
            </div>
            <div className="mt-3 space-y-1">
              {perWarehouse.map((w) => (
                <Link key={w.id} href={`/wms/inventory?warehouse=${w.id}`} className="flex items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-hover">
                  <span className="size-2.5 rounded-sm" style={{ backgroundColor: w.color }} />
                  <span className="flex-1 truncate">{w.name}</span>
                  <span className="tabular-nums text-ink-2">{formatNumber(w.qty)}</span>
                  <span className="w-12 text-right tabular-nums text-ink-3">{totalQty ? Math.round((w.qty / totalQty) * 100) : 0}%</span>
                  <span className="w-28 text-right tabular-nums text-ink-2">{formatMoney(w.value)}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          <Section
            title={`待收货（${pendingIn.length}）`}
            actions={
              <Link href="/wms/inbound?status=PENDING" className="text-xs text-ink-3 hover:text-ink">
                全部 →
              </Link>
            }
          >
            {pendingIn.length === 0 ? (
              <EmptyState title="没有待收货的入库单" />
            ) : (
              <div className="divide-y divide-line border-y border-line">
                {pendingIn.slice(0, 6).map((o) => (
                  <Link key={o.id} href={`/wms/inbound/${o.id}`} className="flex items-center gap-2 px-1 py-2 text-sm hover:bg-sidebar">
                    <span className="font-medium tabular-nums">{o.no}</span>
                    <StatusBadge map={INBOUND_TYPE} value={o.type} />
                    <span className="flex-1 truncate text-ink-2">{o.warehouse.name}</span>
                    <span className="text-xs text-ink-3">{o._count.items} 项 · 预计 {formatDate(o.expectedDate)}</span>
                    <StatusBadge map={INBOUND_STATUS} value={o.status} />
                  </Link>
                ))}
              </div>
            )}
          </Section>
          <Section
            title={`待发货（${pendingOut.length}）`}
            actions={
              <Link href="/wms/outbound?status=open" className="text-xs text-ink-3 hover:text-ink">
                全部 →
              </Link>
            }
          >
            {pendingOut.length === 0 ? (
              <EmptyState title="没有待发货的出库单" />
            ) : (
              <div className="divide-y divide-line border-y border-line">
                {pendingOut.slice(0, 6).map((o) => (
                  <Link key={o.id} href={`/wms/outbound/${o.id}`} className="flex items-center gap-2 px-1 py-2 text-sm hover:bg-sidebar">
                    <span className="font-medium tabular-nums">{o.no}</span>
                    <StatusBadge map={OUTBOUND_TYPE} value={o.type} />
                    <span className="flex-1 truncate text-ink-2">{o.salesOrder?.customer.name ?? o.warehouse.name}</span>
                    <StatusBadge map={OUTBOUND_STATUS} value={o.status} />
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </div>

        <Section
          title="最近库存流水"
          actions={
            <Link href="/wms/movements" className="text-xs text-ink-3 hover:text-ink">
              全部流水 →
            </Link>
          }
        >
          <MovementTable rows={recent} />
        </Section>
      </Page>
    </>
  );
}
