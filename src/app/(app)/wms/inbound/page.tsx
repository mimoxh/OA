import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime } from "@/lib/format";
import { INBOUND_STATUS, INBOUND_TYPE } from "@/lib/labels";
import { pageNum, str } from "@/lib/wms/params";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { NewInboundButton } from "@/components/wms/inbound-forms";
import { Pagination } from "@/components/wms/pagination";
import { UrlSelect } from "@/components/wms/url-filters";
import { MobileCard, MobileList } from "@/components/mobile/mobile-list";

const PAGE_SIZE = 20;

export default async function InboundListPage({ searchParams }: PageProps<"/wms/inbound">) {
  const user = await requireUser();
  const canEdit = can(user, "wms:edit");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const type = str(sp.type);
  const warehouseId = str(sp.warehouse);
  const page = pageNum(sp.page);

  const base: Prisma.InboundOrderWhereInput = {
    ...(type && type in INBOUND_TYPE ? { type: type as keyof typeof INBOUND_TYPE } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(q
      ? { OR: [{ no: { contains: q } }, { remark: { contains: q } }, { purchaseOrder: { no: { contains: q } } }, { purchaseOrder: { supplier: { name: { contains: q } } } }] }
      : {}),
  };
  const where: Prisma.InboundOrderWhereInput = {
    ...base,
    ...(status && status in INBOUND_STATUS ? { status: status as keyof typeof INBOUND_STATUS } : {}),
  };
  const [rows, total, counts, warehouses, products] = await Promise.all([
    db.inboundOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        warehouse: { select: { name: true } },
        purchaseOrder: { select: { id: true, no: true, supplier: { select: { name: true } } } },
        createdBy: { select: { name: true, avatarColor: true } },
        items: { select: { expectedQty: true, receivedQty: true } },
      },
    }),
    db.inboundOrder.count({ where }),
    db.inboundOrder.groupBy({ by: ["status"], where: base, _count: true }),
    db.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, name: true } }),
    canEdit
      ? db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, unit: true } })
      : Promise.resolve([]),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <TopBar
        crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "入库单" }]}
        actions={canEdit ? <NewInboundButton warehouses={warehouses} products={products} /> : null}
      />
      <Page wide>
        <PageHeader icon="📥" title="入库单" description="采购订单审批通过后自动生成采购入库单；退货与其他入库可手工创建" />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterPills
            options={Object.entries(INBOUND_STATUS).map(([value, m]) => ({ value, label: m.label, count: countOf(value) }))}
          />
          <div className="flex-1" />
          <UrlSelect param="type" placeholder="全部类型" options={Object.entries(INBOUND_TYPE).map(([value, m]) => ({ value, label: m.label }))} />
          <UrlSelect param="warehouse" placeholder="全部仓库" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SearchInput placeholder="单号 / 采购单 / 供应商" />
        </div>
        <MobileList empty="暂无入库单">
          {rows.map((o) => {
            const expected = o.items.reduce((s, i) => s + i.expectedQty, 0);
            const received = o.items.reduce((s, i) => s + i.receivedQty, 0);
            return (
              <MobileCard
                key={o.id}
                href={`/wms/inbound/${o.id}`}
                title={o.purchaseOrder ? o.purchaseOrder.supplier.name : o.no}
                badge={<StatusBadge map={INBOUND_STATUS} value={o.status} />}
                subtitle={[o.no, o.purchaseOrder?.no, o.warehouse.name].filter(Boolean).join(" · ")}
                meta={
                  <>
                    <StatusBadge map={INBOUND_TYPE} value={o.type} />
                    <span>{o.receivedAt ? `入库 ${formatDateTime(o.receivedAt)}` : `预计 ${formatDate(o.expectedDate)}`}</span>
                    <UserChip name={o.createdBy.name} color={o.createdBy.avatarColor} />
                  </>
                }
                aside={
                  <span className="flex flex-col items-end">
                    <span>
                      {o.status === "COMPLETED" ? received : "—"} / {expected}
                    </span>
                    <span className="text-xs font-normal text-ink-3">{o.items.length} 项明细</span>
                  </span>
                }
              />
            );
          })}
        </MobileList>
        <Table className="max-md:hidden">
          <THead>
            <TR>
              <TH>单号</TH>
              <TH>类型</TH>
              <TH>仓库</TH>
              <TH>关联采购单</TH>
              <TH>状态</TH>
              <TH>预计到货</TH>
              <TH>实际入库</TH>
              <TH className="text-right">明细</TH>
              <TH className="text-right">数量（实收/应收）</TH>
              <TH>创建人</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 && <TEmpty colSpan={10}>暂无入库单</TEmpty>}
            {rows.map((o) => {
              const expected = o.items.reduce((s, i) => s + i.expectedQty, 0);
              const received = o.items.reduce((s, i) => s + i.receivedQty, 0);
              return (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/wms/inbound/${o.id}`} className="font-medium tabular-nums text-ink hover:text-accent hover:underline">
                      {o.no}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={INBOUND_TYPE} value={o.type} />
                  </TD>
                  <TD className="whitespace-nowrap">{o.warehouse.name}</TD>
                  <TD className="whitespace-nowrap">
                    {o.purchaseOrder ? (
                      <Link href={`/erp/purchase/${o.purchaseOrder.id}`} className="text-accent hover:underline">
                        {o.purchaseOrder.no}
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                    {o.purchaseOrder && <div className="max-w-44 truncate text-xs text-ink-3">{o.purchaseOrder.supplier.name}</div>}
                  </TD>
                  <TD>
                    <StatusBadge map={INBOUND_STATUS} value={o.status} />
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums text-ink-2">{formatDate(o.expectedDate)}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-ink-2">{formatDateTime(o.receivedAt)}</TD>
                  <TD className="text-right tabular-nums">{o.items.length}</TD>
                  <TD className="text-right tabular-nums">
                    {o.status === "COMPLETED" ? received : "—"} / {expected}
                  </TD>
                  <TD>
                    <UserChip name={o.createdBy.name} color={o.createdBy.avatarColor} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination basePath="/wms/inbound" searchParams={sp} page={page} pageSize={PAGE_SIZE} total={total} />
      </Page>
    </>
  );
}
