import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatNumber } from "@/lib/format";
import { OUTBOUND_STATUS, OUTBOUND_TYPE, SALES_STATUS, TRANSPORT_STATUS } from "@/lib/labels";
import { StatusBadge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MovementTable, movementInclude } from "@/components/wms/movement-table";
import { OutboundActions } from "@/components/wms/outbound-forms";
import { Steps } from "@/components/wms/steps";
import { cn } from "@/lib/utils";

const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  #pick-list, #pick-list * { visibility: visible !important; }
  #pick-list { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
}
`;

export default async function OutboundDetailPage({ params }: PageProps<"/wms/outbound/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "wms:edit");
  const order = await db.outboundOrder.findUnique({
    where: { id },
    include: {
      warehouse: true,
      salesOrder: { include: { customer: { select: { id: true, name: true } } } },
      createdBy: { select: { name: true, avatarColor: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true, unit: true, weight: true } } } },
      transportOrders: { orderBy: { createdAt: "desc" }, select: { id: true, no: true, status: true, destination: true } },
    },
  });
  if (!order) notFound();

  const [inventories, movements] = await Promise.all([
    db.inventory.findMany({
      where: { warehouseId: order.warehouseId, productId: { in: order.items.map((i) => i.productId) } },
      include: { location: { select: { code: true, zone: true } } },
    }),
    db.stockMovement.findMany({ where: { refType: "outbound", refId: order.id }, orderBy: { createdAt: "asc" }, include: movementInclude }),
  ]);
  const invMap = new Map(inventories.map((i) => [i.productId, i]));
  const open = order.status === "PENDING" || order.status === "PICKING";
  const current = order.status === "PENDING" ? 0 : order.status === "PICKING" ? 1 : 3;
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const totalWeight = order.items.reduce((s, i) => s + i.quantity * i.product.weight, 0);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <TopBar
        crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "出库单", href: "/wms/outbound" }, { label: order.no }]}
        actions={<OutboundActions id={order.id} status={order.status} type={order.type} canEdit={canEdit} />}
      />
      <Page>
        <PageHeader
          icon="📤"
          title={order.no}
          description={order.remark ?? undefined}
          meta={
            <>
              <StatusBadge map={OUTBOUND_STATUS} value={order.status} />
              <StatusBadge map={OUTBOUND_TYPE} value={order.type} />
            </>
          }
        />
        <Steps
          steps={[
            { label: "待拣货", hint: formatDateTime(order.createdAt) },
            { label: "拣货中" },
            { label: order.status === "CANCELLED" ? "已取消" : "已发货", hint: order.shippedAt ? formatDateTime(order.shippedAt) : undefined },
          ]}
          current={current}
          cancelled={order.status === "CANCELLED"}
        />

        {order.transportOrders.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-tag-blue/40 px-4 py-2.5 text-sm">
            🚚 已生成运输单
            {order.transportOrders.map((t) => (
              <Link key={t.id} href={`/tms/orders/${t.id}`} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                {t.no}
                <StatusBadge map={TRANSPORT_STATUS} value={t.status} />
              </Link>
            ))}
            <span className="text-ink-2">→ {order.transportOrders[0].destination}</span>
          </div>
        )}

        <Section title="基本信息">
          <Properties>
            <Property label="出库仓库">
              <Link href={`/wms/warehouses/${order.warehouse.id}`} className="hover:underline">
                {order.warehouse.name}
              </Link>
              <span className="ml-2 text-xs text-ink-3">{order.warehouse.address}</span>
            </Property>
            <Property label="关联销售单">
              {order.salesOrder ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/erp/sales/${order.salesOrder.id}`} className="text-accent hover:underline">
                    {order.salesOrder.no}
                  </Link>
                  <StatusBadge map={SALES_STATUS} value={order.salesOrder.status} />
                  <Link href={`/crm/customers/${order.salesOrder.customer.id}`} className="text-ink-2 hover:underline">
                    {order.salesOrder.customer.name}
                  </Link>
                </span>
              ) : (
                <span className="text-ink-3">无（手工出库）</span>
              )}
            </Property>
            {order.salesOrder && (
              <Property label="收货信息">
                {order.salesOrder.consignee ?? "—"} {order.salesOrder.consigneePhone ?? ""}
                <span className="ml-2 text-ink-2">{order.salesOrder.shippingAddress}</span>
              </Property>
            )}
            <Property label="合计">
              {formatNumber(totalQty)} 件 · 约 {formatNumber(totalWeight, 1)} kg
            </Property>
            <Property label="发货时间">{formatDateTime(order.shippedAt)}</Property>
            <Property label="创建人">
              <UserChip name={order.createdBy.name} color={order.createdBy.avatarColor} />
            </Property>
            <Property label="创建时间">{formatDateTime(order.createdAt)}</Property>
          </Properties>
          {order.type === "SALES" && open && (
            <p className="text-xs text-ink-3">销售出库单不能在仓库直接取消，如需取消请在销售订单中操作。</p>
          )}
        </Section>

        <Section title="出库明细">
          <Table>
            <THead>
              <TR>
                <TH>产品</TH>
                <TH className="text-right">出库数量</TH>
                {open ? <TH className="text-right">当前库存 / 可用</TH> : <TH className="text-right">已拣数量</TH>}
                <TH>库位</TH>
                <TH className="text-right">重量</TH>
              </TR>
            </THead>
            <TBody>
              {order.items.map((i) => {
                const inv = invMap.get(i.productId);
                const avail = inv ? inv.quantity - inv.reservedQty : 0;
                // 销售出库已预占本单数量，可用量需加回本单预占后再判断是否足够
                const enough = order.type === "SALES" ? (inv?.quantity ?? 0) >= i.quantity : avail >= i.quantity;
                return (
                  <TR key={i.id}>
                    <TD>
                      <div>{i.product.name}</div>
                      <div className="text-xs text-ink-3">{i.product.sku}</div>
                    </TD>
                    <TD className="text-right font-medium tabular-nums">
                      {i.quantity} {i.product.unit}
                    </TD>
                    {open ? (
                      <TD className={cn("text-right tabular-nums", !enough && "text-danger")}>
                        {inv?.quantity ?? 0} / {avail}
                        {!enough && <div className="text-xs">库存不足</div>}
                      </TD>
                    ) : (
                      <TD className="text-right tabular-nums">{order.status === "SHIPPED" ? i.pickedQty : "—"}</TD>
                    )}
                    <TD className="font-mono text-xs">{inv?.location?.code ?? "—"}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{formatNumber(i.quantity * i.product.weight, 1)} kg</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>

        {movements.length > 0 && (
          <Section title="库存流水">
            <MovementTable rows={movements} hideWarehouse />
          </Section>
        )}
      </Page>

      <div id="pick-list" className="hidden bg-white p-2 text-[12px] text-black">
        <div className="flex items-end justify-between border-b-2 border-black pb-2">
          <div>
            <div className="text-xl font-bold">拣货单</div>
            <div className="mt-1">
              {order.warehouse.name}（{order.warehouse.code}）
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-semibold">{order.no}</div>
            <div>打印时间：{formatDateTime(new Date())}</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <div>类型：{OUTBOUND_TYPE[order.type].label}</div>
          <div>状态：{OUTBOUND_STATUS[order.status].label}</div>
          <div>关联销售单：{order.salesOrder?.no ?? "—"}</div>
          <div>客户：{order.salesOrder?.customer.name ?? "—"}</div>
          <div className="col-span-2">收货地址：{order.salesOrder?.shippingAddress ?? "—"}</div>
          <div className="col-span-2">备注：{order.remark ?? "—"}</div>
        </div>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr>
              {["序号", "库位", "SKU", "产品", "数量", "单位", "实拣", "签字"].map((h) => (
                <th key={h} className="border border-black px-1.5 py-1 text-left font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...order.items]
              .sort((a, b) => (invMap.get(a.productId)?.location?.code ?? "").localeCompare(invMap.get(b.productId)?.location?.code ?? ""))
              .map((i, idx) => (
                <tr key={i.id}>
                  <td className="border border-black px-1.5 py-1">{idx + 1}</td>
                  <td className="border border-black px-1.5 py-1 font-mono">{invMap.get(i.productId)?.location?.code ?? ""}</td>
                  <td className="border border-black px-1.5 py-1 font-mono">{i.product.sku}</td>
                  <td className="border border-black px-1.5 py-1">{i.product.name}</td>
                  <td className="border border-black px-1.5 py-1 text-right">{i.quantity}</td>
                  <td className="border border-black px-1.5 py-1">{i.product.unit}</td>
                  <td className="w-16 border border-black px-1.5 py-1" />
                  <td className="w-20 border border-black px-1.5 py-1" />
                </tr>
              ))}
          </tbody>
        </table>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div>拣货人：________________</div>
          <div>复核人：________________</div>
          <div>日期：________________</div>
        </div>
      </div>
    </>
  );
}
