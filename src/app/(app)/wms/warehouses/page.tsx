import Link from "next/link";
import { MapPin, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatMoney, formatNumber } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { WarehouseDialog } from "@/components/wms/warehouse-forms";

export default async function WarehousesPage() {
  const user = await requireUser();
  const canEdit = can(user, "wms:edit");
  const [warehouses, users] = await Promise.all([
    db.warehouse.findMany({
      orderBy: { code: "asc" },
      include: {
        manager: { select: { name: true, avatarColor: true } },
        _count: { select: { locations: true } },
        inventories: { select: { quantity: true, product: { select: { cost: true } } } },
        inboundOrders: { where: { status: "PENDING" }, select: { id: true } },
        outboundOrders: { where: { status: { in: ["PENDING", "PICKING"] } }, select: { id: true } },
      },
    }),
    canEdit ? db.user.findMany({ where: { active: true, isBot: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  return (
    <>
      <TopBar
        crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "仓库与库位" }]}
        actions={
          canEdit ? (
            <WarehouseDialog
              users={users}
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建仓库
                </Button>
              }
            />
          ) : null
        }
      />
      <Page>
        <PageHeader icon="🏬" title="仓库与库位" description="管理仓库、负责人与库位，点击卡片查看库位和库存" />
        {warehouses.length === 0 ? (
          <EmptyState title="还没有仓库" description="新建仓库后即可维护库位、收货入库" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {warehouses.map((w) => {
              const qty = w.inventories.reduce((s, i) => s + i.quantity, 0);
              const value = w.inventories.reduce((s, i) => s + i.quantity * i.product.cost, 0);
              return (
                <Link
                  key={w.id}
                  href={`/wms/warehouses/${w.id}`}
                  className="group flex flex-col rounded-lg border border-line bg-white p-4 transition-colors hover:bg-sidebar"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🏭</span>
                        <span className="truncate text-[15px] font-semibold text-ink">{w.name}</span>
                        <span className="rounded bg-hover px-1.5 font-mono text-[11px] text-ink-2">{w.code}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[13px] text-ink-2">
                        <MapPin className="size-3.5 shrink-0 text-ink-3" />
                        <span className="truncate">{w.address || "未填写地址"}</span>
                      </div>
                    </div>
                    {w.active ? <Badge color="green">启用</Badge> : <Badge color="gray">停用</Badge>}
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3 text-[13px]">
                    <div>
                      <div className="text-xs text-ink-3">库位</div>
                      <div className="font-medium tabular-nums">{w._count.locations}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-3">库存量</div>
                      <div className="font-medium tabular-nums">{formatNumber(qty)}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs text-ink-3">库存金额</div>
                      <div className="font-medium tabular-nums">{formatMoney(value)}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-ink-2">
                    <span className="flex items-center gap-1.5">
                      {w.manager ? (
                        <>
                          <Avatar name={w.manager.name} color={w.manager.avatarColor} size={18} />
                          负责人 {w.manager.name}
                        </>
                      ) : (
                        "未指定负责人"
                      )}
                    </span>
                    <span>
                      待收货 {w.inboundOrders.length} · 待发货 {w.outboundOrders.length}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Page>
    </>
  );
}
