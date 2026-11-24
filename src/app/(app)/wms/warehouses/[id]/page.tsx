import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { LOCATION_TYPE } from "@/lib/wms/constants";
import { UserChip } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { MovementTable, movementInclude } from "@/components/wms/movement-table";
import { DeleteWarehouseButton, LocationDialog, LocationRowActions, WarehouseDialog } from "@/components/wms/warehouse-forms";
import { cn } from "@/lib/utils";

export default async function WarehouseDetailPage({ params }: PageProps<"/wms/warehouses/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "wms:edit");
  const wh = await db.warehouse.findUnique({
    where: { id },
    include: {
      manager: { select: { name: true, avatarColor: true } },
      locations: { orderBy: { code: "asc" }, include: { _count: { select: { inventories: true } } } },
      inventories: {
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true, safetyStock: true, cost: true } },
          location: { select: { code: true } },
        },
        orderBy: { product: { sku: "asc" } },
      },
    },
  });
  if (!wh) notFound();
  const [users, recent] = await Promise.all([
    canEdit ? db.user.findMany({ where: { active: true, isBot: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.stockMovement.findMany({ where: { warehouseId: wh.id }, orderBy: { createdAt: "desc" }, take: 8, include: movementInclude }),
  ]);
  const qty = wh.inventories.reduce((s, i) => s + i.quantity, 0);
  const value = wh.inventories.reduce((s, i) => s + i.quantity * i.product.cost, 0);

  return (
    <>
      <TopBar
        crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "仓库与库位", href: "/wms/warehouses" }, { label: wh.name }]}
        actions={
          canEdit ? (
            <>
              <DeleteWarehouseButton id={wh.id} name={wh.name} />
              <WarehouseDialog
                warehouse={{ id: wh.id, code: wh.code, name: wh.name, address: wh.address, managerId: wh.managerId, active: wh.active }}
                users={users}
                trigger={
                  <Button>
                    <Pencil className="size-3.5" />
                    编辑
                  </Button>
                }
              />
            </>
          ) : null
        }
      />
      <Page>
        <PageHeader
          icon="🏭"
          title={wh.name}
          meta={
            <>
              <span className="rounded bg-hover px-1.5 font-mono text-xs text-ink-2">{wh.code}</span>
              {wh.active ? <Badge color="green">启用</Badge> : <Badge color="gray">停用</Badge>}
            </>
          }
        />
        <Properties>
          <Property label="地址">{wh.address || <span className="text-ink-3">未填写</span>}</Property>
          <Property label="负责人">
            <UserChip name={wh.manager?.name} color={wh.manager?.avatarColor} />
          </Property>
          <Property label="库存">
            {formatNumber(qty)} 件 · {wh.inventories.length} 个 SKU · {formatMoney(value)}
          </Property>
          <Property label="创建时间">{formatDateTime(wh.createdAt)}</Property>
        </Properties>

        <Section
          title={`库位（${wh.locations.length}）`}
          actions={
            canEdit ? (
              <LocationDialog
                warehouseId={wh.id}
                trigger={
                  <Button size="xs" variant="ghost">
                    <Plus className="size-3.5" />
                    新建库位
                  </Button>
                }
              />
            ) : null
          }
        >
          {wh.locations.length === 0 ? (
            <EmptyState title="还没有库位" description="新建库位后，收货时可选择上架库位" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>库位编码</TH>
                  <TH>库区</TH>
                  <TH>类型</TH>
                  <TH className="text-right">默认库位产品数</TH>
                  {canEdit && <TH className="w-20" />}
                </TR>
              </THead>
              <TBody>
                {wh.locations.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-mono text-[13px]">{l.code}</TD>
                    <TD>{l.zone ?? <span className="text-ink-3">—</span>}</TD>
                    <TD>
                      <StatusBadge map={LOCATION_TYPE} value={l.type} />
                    </TD>
                    <TD className="text-right tabular-nums">{l._count.inventories}</TD>
                    {canEdit && (
                      <TD>
                        <LocationRowActions warehouseId={wh.id} location={{ id: l.id, code: l.code, zone: l.zone, type: l.type }} />
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>

        <Section
          title="仓库库存"
          actions={
            <Link href={`/wms/inventory?warehouse=${wh.id}`} className="text-xs text-ink-3 hover:text-ink">
              在库存中查看 →
            </Link>
          }
        >
          <Table>
            <THead>
              <TR>
                <TH>SKU</TH>
                <TH>产品</TH>
                <TH>默认库位</TH>
                <TH className="text-right">库存</TH>
                <TH className="text-right">预占</TH>
                <TH className="text-right">可用</TH>
                <TH className="text-right">金额</TH>
              </TR>
            </THead>
            <TBody>
              {wh.inventories.length === 0 && <TEmpty colSpan={7}>该仓库暂无库存</TEmpty>}
              {wh.inventories.map((i) => {
                const low = i.quantity < i.product.safetyStock;
                return (
                  <TR key={i.id}>
                    <TD className="font-mono text-xs text-ink-2">{i.product.sku}</TD>
                    <TD>{i.product.name}</TD>
                    <TD className="font-mono text-xs">{i.location?.code ?? "—"}</TD>
                    <TD className={cn("text-right tabular-nums", low && "font-medium text-danger")}>{formatNumber(i.quantity)}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{i.reservedQty || "—"}</TD>
                    <TD className="text-right tabular-nums">{formatNumber(i.quantity - i.reservedQty)}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{formatMoney(i.quantity * i.product.cost)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>

        <Section
          title="最近流水"
          actions={
            <Link href={`/wms/movements?warehouse=${wh.id}`} className="text-xs text-ink-3 hover:text-ink">
              全部 →
            </Link>
          }
        >
          <MovementTable rows={recent} hideWarehouse />
        </Section>
      </Page>
    </>
  );
}
