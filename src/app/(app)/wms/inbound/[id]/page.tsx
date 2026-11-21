import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime } from "@/lib/format";
import { INBOUND_STATUS, INBOUND_TYPE, PURCHASE_STATUS } from "@/lib/labels";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ReceiveForm } from "@/components/wms/inbound-forms";
import { MovementTable, movementInclude } from "@/components/wms/movement-table";
import { Steps } from "@/components/wms/steps";
import { cn } from "@/lib/utils";

export default async function InboundDetailPage({ params }: PageProps<"/wms/inbound/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "wms:edit");
  const order = await db.inboundOrder.findUnique({
    where: { id },
    include: {
      warehouse: { include: { locations: { orderBy: { code: "asc" } } } },
      purchaseOrder: { include: { supplier: { select: { id: true, name: true } } } },
      createdBy: { select: { name: true, avatarColor: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } }, location: { select: { code: true } } } },
    },
  });
  if (!order) notFound();

  const [movements, siblings, inventories] = await Promise.all([
    db.stockMovement.findMany({ where: { refType: "inbound", refId: order.id }, orderBy: { createdAt: "asc" }, include: movementInclude }),
    order.purchaseOrderId
      ? db.inboundOrder.findMany({
          where: { purchaseOrderId: order.purchaseOrderId, NOT: { id: order.id } },
          orderBy: { createdAt: "asc" },
          select: { id: true, no: true, status: true, createdAt: true },
        })
      : Promise.resolve([]),
    db.inventory.findMany({
      where: { warehouseId: order.warehouseId, productId: { in: order.items.map((i) => i.productId) } },
      select: { productId: true, locationId: true },
    }),
  ]);
  const defaultLoc = new Map(inventories.map((i) => [i.productId, i.locationId]));
  const pending = order.status === "PENDING";
  const stepIndex = order.status === "COMPLETED" ? 2 : 1;

  return (
    <>
      <TopBar crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "入库单", href: "/wms/inbound" }, { label: order.no }]} />
      <Page>
        <PageHeader
          icon="📥"
          title={order.no}
          description={order.remark ?? undefined}
          meta={
            <>
              <StatusBadge map={INBOUND_STATUS} value={order.status} />
              <StatusBadge map={INBOUND_TYPE} value={order.type} />
            </>
          }
        />
        <Steps
          steps={[
            { label: "创建入库单", hint: formatDateTime(order.createdAt) },
            { label: "待收货", hint: order.expectedDate ? `预计 ${formatDate(order.expectedDate)}` : undefined },
            { label: order.status === "CANCELLED" ? "已取消" : "已入库", hint: order.receivedAt ? formatDateTime(order.receivedAt) : undefined },
          ]}
          current={stepIndex}
          cancelled={order.status === "CANCELLED"}
        />

        <Section title="基本信息">
          <Properties>
            <Property label="入库仓库">
              <Link href={`/wms/warehouses/${order.warehouse.id}`} className="hover:underline">
                {order.warehouse.name}
              </Link>
              <span className="ml-2 text-xs text-ink-3">{order.warehouse.address}</span>
            </Property>
            <Property label="关联采购单">
              {order.purchaseOrder ? (
                <span className="flex items-center gap-2">
                  <Link href={`/erp/purchase/${order.purchaseOrder.id}`} className="text-accent hover:underline">
                    {order.purchaseOrder.no}
                  </Link>
                  <StatusBadge map={PURCHASE_STATUS} value={order.purchaseOrder.status} />
                  <span className="text-ink-2">{order.purchaseOrder.supplier.name}</span>
                </span>
              ) : (
                <span className="text-ink-3">无（手工入库）</span>
              )}
            </Property>
            <Property label="预计到货">{formatDate(order.expectedDate)}</Property>
            <Property label="入库时间">{formatDateTime(order.receivedAt)}</Property>
            <Property label="创建人">
              <UserChip name={order.createdBy.name} color={order.createdBy.avatarColor} />
            </Property>
            <Property label="创建时间">{formatDateTime(order.createdAt)}</Property>
            {siblings.length > 0 && (
              <Property label="同采购单入库">
                <span className="flex flex-wrap items-center gap-2">
                  {siblings.map((s) => (
                    <Link key={s.id} href={`/wms/inbound/${s.id}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                      {s.no}
                      <StatusBadge map={INBOUND_STATUS} value={s.status} />
                    </Link>
                  ))}
                </span>
              </Property>
            )}
          </Properties>
        </Section>

        <Section title={pending ? "收货明细" : "入库明细"}>
          {pending ? (
            <ReceiveForm
              inboundId={order.id}
              canEdit={canEdit}
              locations={order.warehouse.locations.map((l) => ({ id: l.id, code: l.code, zone: l.zone }))}
              items={order.items.map((i) => ({
                id: i.id,
                product: i.product,
                expectedQty: i.expectedQty,
                locationId: i.locationId ?? defaultLoc.get(i.productId) ?? null,
              }))}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>产品</TH>
                  <TH className="text-right">应收</TH>
                  <TH className="text-right">实收</TH>
                  <TH className="text-right">差异</TH>
                  <TH>上架库位</TH>
                </TR>
              </THead>
              <TBody>
                {order.items.map((i) => {
                  const diff = i.receivedQty - i.expectedQty;
                  return (
                    <TR key={i.id}>
                      <TD>
                        <div>{i.product.name}</div>
                        <div className="text-xs text-ink-3">{i.product.sku}</div>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {i.expectedQty} {i.product.unit}
                      </TD>
                      <TD className="text-right font-medium tabular-nums">{order.status === "COMPLETED" ? i.receivedQty : "—"}</TD>
                      <TD className={cn("text-right tabular-nums", diff < 0 && order.status === "COMPLETED" ? "text-[#cb912f]" : "text-ink-3")}>
                        {order.status === "COMPLETED" ? (diff === 0 ? "—" : diff) : "—"}
                      </TD>
                      <TD className="font-mono text-xs">{i.location?.code ?? "—"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Section>

        {movements.length > 0 && (
          <Section title="库存流水">
            <MovementTable rows={movements} hideWarehouse />
          </Section>
        )}
      </Page>
    </>
  );
}
