import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { OUTBOUND_STATUS, OUTBOUND_TYPE, TRANSPORT_STATUS } from "@/lib/labels";
import { pageNum, str } from "@/lib/wms/params";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { NewOutboundButton } from "@/components/wms/outbound-forms";
import { Pagination } from "@/components/wms/pagination";
import { UrlSelect } from "@/components/wms/url-filters";

const PAGE_SIZE = 20;

export default async function OutboundListPage({ searchParams }: PageProps<"/wms/outbound">) {
  const user = await requireUser();
  const canEdit = can(user, "wms:edit");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const type = str(sp.type);
  const warehouseId = str(sp.warehouse);
  const page = pageNum(sp.page);

  const base: Prisma.OutboundOrderWhereInput = {
    ...(type && type in OUTBOUND_TYPE ? { type: type as keyof typeof OUTBOUND_TYPE } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(q
      ? {
          OR: [
            { no: { contains: q } },
            { remark: { contains: q } },
            { salesOrder: { no: { contains: q } } },
            { salesOrder: { customer: { name: { contains: q } } } },
          ],
        }
      : {}),
  };
  const statusWhere: Prisma.OutboundOrderWhereInput =
    status === "open"
      ? { status: { in: ["PENDING", "PICKING"] } }
      : status && status in OUTBOUND_STATUS
        ? { status: status as keyof typeof OUTBOUND_STATUS }
        : {};
  const where = { ...base, ...statusWhere };

  const [rows, total, counts, warehouses, products, inventories] = await Promise.all([
    db.outboundOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        warehouse: { select: { name: true } },
        salesOrder: { select: { id: true, no: true, customer: { select: { name: true } } } },
        createdBy: { select: { name: true, avatarColor: true } },
        items: { select: { quantity: true } },
        transportOrders: { select: { id: true, no: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.outboundOrder.count({ where }),
    db.outboundOrder.groupBy({ by: ["status"], where: base, _count: true }),
    db.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, name: true } }),
    canEdit
      ? db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, unit: true } })
      : Promise.resolve([]),
    canEdit ? db.inventory.findMany({ select: { productId: true, warehouseId: true, quantity: true, reservedQty: true } }) : Promise.resolve([]),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const available: Record<string, Record<string, number>> = {};
  for (const i of inventories) {
    (available[i.warehouseId] ??= {})[i.productId] = i.quantity - i.reservedQty;
  }

  return (
    <>
      <TopBar
        crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "出库单" }]}
        actions={canEdit ? <NewOutboundButton warehouses={warehouses} products={products} available={available} /> : null}
      />
      <Page wide>
        <PageHeader icon="📤" title="出库单" description="销售订单确认后自动生成销售出库单，拣货发货后自动生成运输单" />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterPills
            options={[
              { value: "open", label: "待处理", count: countOf("PENDING") + countOf("PICKING") },
              ...Object.entries(OUTBOUND_STATUS).map(([value, m]) => ({ value, label: m.label, count: countOf(value) })),
            ]}
          />
          <div className="flex-1" />
          <UrlSelect param="type" placeholder="全部类型" options={Object.entries(OUTBOUND_TYPE).map(([value, m]) => ({ value, label: m.label }))} />
          <UrlSelect param="warehouse" placeholder="全部仓库" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SearchInput placeholder="单号 / 销售单 / 客户" />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>单号</TH>
              <TH>类型</TH>
              <TH>仓库</TH>
              <TH>关联销售单</TH>
              <TH>状态</TH>
              <TH className="text-right">明细</TH>
              <TH className="text-right">数量</TH>
              <TH>发货时间</TH>
              <TH>运输单</TH>
              <TH>创建人</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 && <TEmpty colSpan={10}>暂无出库单</TEmpty>}
            {rows.map((o) => {
              const t = o.transportOrders[0];
              return (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/wms/outbound/${o.id}`} className="font-medium tabular-nums text-ink hover:text-accent hover:underline">
                      {o.no}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={OUTBOUND_TYPE} value={o.type} />
                  </TD>
                  <TD className="whitespace-nowrap">{o.warehouse.name}</TD>
                  <TD className="whitespace-nowrap">
                    {o.salesOrder ? (
                      <>
                        <Link href={`/erp/sales/${o.salesOrder.id}`} className="text-accent hover:underline">
                          {o.salesOrder.no}
                        </Link>
                        <div className="max-w-44 truncate text-xs text-ink-3">{o.salesOrder.customer.name}</div>
                      </>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </TD>
                  <TD>
                    <StatusBadge map={OUTBOUND_STATUS} value={o.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{o.items.length}</TD>
                  <TD className="text-right tabular-nums">{o.items.reduce((s, i) => s + i.quantity, 0)}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-ink-2">{formatDateTime(o.shippedAt)}</TD>
                  <TD className="whitespace-nowrap">
                    {t ? (
                      <Link href={`/tms/orders/${t.id}`} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                        {t.no}
                        <StatusBadge map={TRANSPORT_STATUS} value={t.status} />
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </TD>
                  <TD>
                    <UserChip name={o.createdBy.name} color={o.createdBy.avatarColor} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination basePath="/wms/outbound" searchParams={sp} page={page} pageSize={PAGE_SIZE} total={total} />
      </Page>
    </>
  );
}
