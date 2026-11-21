import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { OPPORTUNITY_STAGE, OUTBOUND_STATUS, SALES_STATUS, TRANSPORT_STATUS } from "@/lib/labels";
import { ERP_AUDIT_ACTION, SALES_STEPS } from "@/lib/erp/labels";
import { round2 } from "@/lib/erp/params";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { UserChip } from "@/components/ui/avatar";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/erp/action-button";
import { AuditTimeline } from "@/components/erp/audit-timeline";
import { StatusSteps } from "@/components/erp/status-steps";
import { InvoicePayments } from "@/components/finance/invoice-payments";
import { cancelSales, confirmSales, deleteSalesOrder } from "@/app/(app)/erp/actions";

export default async function SalesDetailPage({ params }: PageProps<"/erp/sales/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const so = await db.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      opportunity: true,
      warehouse: true,
      createdBy: true,
      items: { include: { product: true }, orderBy: { id: "asc" } },
      outboundOrders: { include: { items: true }, orderBy: { createdAt: "asc" } },
      transportOrders: { include: { vehicle: true, driver: true }, orderBy: { createdAt: "asc" } },
      invoices: {
        include: { payments: { include: { createdBy: true }, orderBy: { paidAt: "desc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!so) notFound();
  const [logs, inventories] = await Promise.all([
    db.auditLog.findMany({ where: { entityType: "sales_order", entityId: so.id }, include: { user: true }, orderBy: { createdAt: "desc" } }),
    so.status === "DRAFT"
      ? db.inventory.findMany({ where: { warehouseId: so.warehouseId, productId: { in: so.items.map((i) => i.productId) } } })
      : Promise.resolve([]),
  ]);
  const avail = new Map(inventories.map((i) => [i.productId, i.quantity - i.reservedQty]));
  const shortage = so.status === "DRAFT" ? so.items.filter((i) => (avail.get(i.productId) ?? 0) < i.quantity) : [];

  const s = so.status;
  const received = round2(so.invoices.filter((i) => i.status !== "VOID").reduce((t, i) => t + i.paidAmount, 0));
  const receivable = round2(so.invoices.filter((i) => i.status !== "VOID").reduce((t, i) => t + i.amount, 0));

  const actions = canEdit && (
    <>
      {(s === "DRAFT" || s === "CANCELLED") && (
        <ActionButton
          action={deleteSalesOrder.bind(null, so.id)}
          success="销售订单已删除"
          redirectTo="/erp/sales"
          variant="ghost"
          danger
          confirmText="删除"
          confirm={{ title: `删除销售订单 ${so.no}？`, description: "删除后无法恢复。" }}
        >
          删除
        </ActionButton>
      )}
      {(s === "DRAFT" || s === "CONFIRMED") && (
        <ActionButton
          action={cancelSales.bind(null, so.id)}
          success="订单已取消"
          danger
          confirmText="取消订单"
          confirm={{
            title: `取消销售订单 ${so.no}？`,
            description: s === "CONFIRMED" ? "将释放已预占的库存，并取消未发货的出库单。" : "取消后订单不能再确认。",
          }}
        >
          取消订单
        </ActionButton>
      )}
      {s === "DRAFT" && <LinkButton href={`/erp/sales/${so.id}/edit`}>编辑</LinkButton>}
      {s === "DRAFT" && (
        <ActionButton
          variant="primary"
          action={confirmSales.bind(null, so.id)}
          success="订单已确认，库存已预占并生成出库单"
          confirmText="确认订单"
          confirm={{
            title: `确认销售订单 ${so.no}？`,
            description: `将从「${so.warehouse.name}」预占库存并生成出库单，确认后不能再修改明细。`,
          }}
        >
          确认订单
        </ActionButton>
      )}
    </>
  );

  return (
    <>
      <TopBar crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "销售订单", href: "/erp/sales" }, { label: so.no }]} actions={actions} />
      <Page>
        <PageHeader
          icon="🧾"
          title={so.no}
          description={
            <Link href={`/crm/customers/${so.customerId}`} className="hover:underline">
              {so.customer.name}
            </Link>
          }
          meta={
            <>
              <StatusBadge map={SALES_STATUS} value={so.status} />
              <span className="text-ink-2">
                金额 <span className="font-semibold text-ink">{formatMoney(so.totalAmount)}</span>
              </span>
              {receivable > 0 && (
                <span className="text-ink-2">
                  已收 {formatMoney(received)} / {formatMoney(receivable)}
                </span>
              )}
            </>
          }
        />
        <StatusSteps steps={SALES_STEPS} current={s === "CANCELLED" ? "DRAFT" : s} aborted={s === "CANCELLED" ? "已取消" : null} />
        {shortage.length > 0 && (
          <div className="mt-3 rounded-md border border-tag-orange bg-tag-orange/40 px-3 py-2 text-sm text-tag-orange-ink">
            「{so.warehouse.name}」可用库存不足：
            {shortage.map((i) => `${i.product.name}（需 ${i.quantity}，可用 ${avail.get(i.productId) ?? 0}）`).join("、")}
            。请补货或调整明细后再确认。
          </div>
        )}

        <Properties>
          <Property label="客户">
            <Link href={`/crm/customers/${so.customerId}`} className="text-accent hover:underline">
              {so.customer.name}
            </Link>
          </Property>
          <Property label="关联商机">
            {so.opportunity ? (
              <span className="inline-flex items-center gap-2">
                <Link href={`/crm/opportunities/${so.opportunity.id}`} className="text-accent hover:underline">
                  {so.opportunity.name}
                </Link>
                <StatusBadge map={OPPORTUNITY_STAGE} value={so.opportunity.stage} />
              </span>
            ) : (
              <span className="text-ink-3">—</span>
            )}
          </Property>
          <Property label="发货仓库">{so.warehouse.name}</Property>
          <Property label="收货人">
            {so.consignee ?? "—"}
            {so.consigneePhone && <span className="ml-2 text-ink-2">{so.consigneePhone}</span>}
          </Property>
          <Property label="收货地址">{so.shippingAddress ?? <span className="text-danger">未填写</span>}</Property>
          <Property label="下单日期">{formatDate(so.orderDate)}</Property>
          <Property label="创建人">
            <UserChip name={so.createdBy.name} color={so.createdBy.avatarColor} />
          </Property>
          <Property label="备注">{so.remark ?? "—"}</Property>
        </Properties>

        <Section title="订单明细">
          <Table>
            <THead>
              <TR>
                <TH>SKU</TH>
                <TH>产品</TH>
                <TH className="text-right">数量</TH>
                <TH className="text-right">已发货</TH>
                <TH className="text-right">单价</TH>
                <TH className="text-right">小计</TH>
              </TR>
            </THead>
            <TBody>
              {so.items.map((i) => (
                <TR key={i.id}>
                  <TD className="font-mono text-xs text-ink-2">{i.product.sku}</TD>
                  <TD>
                    <Link href={`/erp/products/${i.productId}`} className="hover:underline">
                      {i.product.name}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatNumber(i.quantity)} <span className="text-ink-3">{i.product.unit}</span>
                  </TD>
                  <TD className={`text-right tabular-nums ${i.shippedQty >= i.quantity ? "text-[#448361]" : "text-ink-3"}`}>
                    {formatNumber(i.shippedQty)}
                  </TD>
                  <TD className="text-right tabular-nums">{formatMoney(i.price)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(i.quantity * i.price)}</TD>
                </TR>
              ))}
              <TR>
                <TD colSpan={5} className="text-right text-ink-2">
                  合计
                </TD>
                <TD className="text-right font-semibold tabular-nums">{formatMoney(so.totalAmount)}</TD>
              </TR>
            </TBody>
          </Table>
        </Section>

        <Section title={`出库单 · ${so.outboundOrders.length}`}>
          <Table>
            <THead>
              <TR>
                <TH>出库单号</TH>
                <TH>状态</TH>
                <TH className="text-right">数量</TH>
                <TH>创建时间</TH>
                <TH>发货时间</TH>
              </TR>
            </THead>
            <TBody>
              {so.outboundOrders.length === 0 && <TEmpty colSpan={5}>确认订单后自动生成出库单</TEmpty>}
              {so.outboundOrders.map((ob) => (
                <TR key={ob.id}>
                  <TD>
                    <Link href={`/wms/outbound/${ob.id}`} className="font-medium text-accent hover:underline">
                      {ob.no}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={OUTBOUND_STATUS} value={ob.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(ob.items.reduce((t, i) => t + i.quantity, 0))}</TD>
                  <TD className="text-ink-2">{formatDateTime(ob.createdAt)}</TD>
                  <TD className="text-ink-2">{formatDateTime(ob.shippedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section title={`运输单 · ${so.transportOrders.length}`}>
          <Table>
            <THead>
              <TR>
                <TH>运输单号</TH>
                <TH>状态</TH>
                <TH>车辆</TH>
                <TH>司机</TH>
                <TH>目的地</TH>
                <TH>发车</TH>
                <TH>签收</TH>
              </TR>
            </THead>
            <TBody>
              {so.transportOrders.length === 0 && <TEmpty colSpan={7}>仓库发货后自动生成运输单</TEmpty>}
              {so.transportOrders.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <Link href={`/tms/orders/${t.id}`} className="font-medium text-accent hover:underline">
                      {t.no}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={TRANSPORT_STATUS} value={t.status} />
                  </TD>
                  <TD>{t.vehicle ? `${t.vehicle.plateNo}（${t.vehicle.type}）` : <span className="text-ink-3">待调度</span>}</TD>
                  <TD>{t.driver ? `${t.driver.name} ${t.driver.phone}` : <span className="text-ink-3">—</span>}</TD>
                  <TD className="max-w-48 truncate text-ink-2">{t.destination}</TD>
                  <TD className="text-ink-2">{formatDateTime(t.departedAt)}</TD>
                  <TD className="text-ink-2">{formatDateTime(t.deliveredAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section title="应收发票与收款">
          <InvoicePayments invoices={so.invoices} canPay={can(user, "finance:edit")} empty="客户签收后自动生成应收发票" />
        </Section>

        <Section title="操作日志">
          <AuditTimeline logs={logs} labels={ERP_AUDIT_ACTION} />
        </Section>
      </Page>
    </>
  );
}
