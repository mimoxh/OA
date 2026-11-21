import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { APPROVAL_STATUS, APPROVAL_TASK_STATUS, INBOUND_STATUS, PURCHASE_STATUS } from "@/lib/labels";
import { ERP_AUDIT_ACTION, PURCHASE_STEPS } from "@/lib/erp/labels";
import { round2 } from "@/lib/erp/params";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { Card, Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/erp/action-button";
import { AuditTimeline } from "@/components/erp/audit-timeline";
import { StatusSteps } from "@/components/erp/status-steps";
import { InvoicePayments } from "@/components/finance/invoice-payments";
import {
  cancelPurchaseOrder,
  deletePurchaseOrder,
  submitPurchaseOrder,
  withdrawPurchaseOrder,
} from "@/app/(app)/erp/actions";

export default async function PurchaseDetailPage({ params }: PageProps<"/erp/purchase/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: true,
      createdBy: true,
      items: { include: { product: true }, orderBy: { id: "asc" } },
      inboundOrders: { include: { items: true }, orderBy: { createdAt: "asc" } },
      invoices: {
        include: { payments: { include: { createdBy: true }, orderBy: { paidAt: "desc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!po) notFound();
  const [instances, logs] = await Promise.all([
    db.approvalInstance.findMany({
      where: { bizType: "purchase_order", bizId: po.id },
      include: { tasks: { include: { approver: true }, orderBy: [{ step: "asc" }, { createdAt: "asc" }] }, applicant: true },
      orderBy: { createdAt: "desc" },
    }),
    db.auditLog.findMany({
      where: { entityType: "purchase_order", entityId: po.id },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const current = instances.find((i) => i.id === po.approvalInstanceId) ?? instances[0];
  const history = instances.filter((i) => i.id !== current?.id);

  const s = po.status;
  const totalQty = po.items.reduce((t, i) => t + i.quantity, 0);
  const receivedQty = po.items.reduce((t, i) => t + i.receivedQty, 0);
  const invoiced = round2(po.invoices.filter((i) => i.status !== "VOID").reduce((t, i) => t + i.amount, 0));
  const paid = round2(po.invoices.filter((i) => i.status !== "VOID").reduce((t, i) => t + i.paidAmount, 0));
  const stepKey = s === "PARTIAL_RECEIVED" ? "APPROVED" : s === "REJECTED" ? "PENDING_APPROVAL" : s === "CANCELLED" ? "DRAFT" : s;
  const canWithdraw = s === "PENDING_APPROVAL" && current?.applicantId === user.id;

  const actions = canEdit && (
    <>
      {(s === "DRAFT" || s === "CANCELLED") && (
        <ActionButton
          action={deletePurchaseOrder.bind(null, po.id)}
          success="采购单已删除"
          redirectTo="/erp/purchase"
          danger
          variant="ghost"
          confirmText="删除"
          confirm={{ title: `删除采购单 ${po.no}？`, description: "删除后无法恢复。" }}
        >
          删除
        </ActionButton>
      )}
      {(s === "DRAFT" || s === "REJECTED" || s === "APPROVED") && (
        <ActionButton
          action={cancelPurchaseOrder.bind(null, po.id)}
          success="采购单已取消"
          danger
          confirmText="取消订单"
          confirm={{
            title: `取消采购单 ${po.no}？`,
            description: s === "APPROVED" ? "待收货的入库单将一并取消。" : "取消后不能再提交审批。",
          }}
        >
          取消订单
        </ActionButton>
      )}
      {canWithdraw && (
        <ActionButton
          action={withdrawPurchaseOrder.bind(null, po.id)}
          success="已撤回审批，采购单回到草稿"
          confirmText="撤回"
          confirm={{ title: "撤回审批？", description: "撤回后采购单回到草稿状态，可修改后重新提交。" }}
        >
          撤回审批
        </ActionButton>
      )}
      {(s === "DRAFT" || s === "REJECTED") && <LinkButton href={`/erp/purchase/${po.id}/edit`}>编辑</LinkButton>}
      {s === "DRAFT" && (
        <ActionButton variant="primary" action={submitPurchaseOrder.bind(null, po.id)} success="已提交审批">
          提交审批
        </ActionButton>
      )}
      {s === "REJECTED" && (
        <ActionButton variant="primary" action={submitPurchaseOrder.bind(null, po.id)} success="已重新提交审批">
          重新提交
        </ActionButton>
      )}
    </>
  );

  return (
    <>
      <TopBar crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "采购订单", href: "/erp/purchase" }, { label: po.no }]} actions={actions} />
      <Page>
        <PageHeader
          icon="🛒"
          title={po.no}
          description={
            <Link href={`/erp/suppliers/${po.supplierId}`} className="hover:underline">
              {po.supplier.name}
            </Link>
          }
          meta={
            <>
              <StatusBadge map={PURCHASE_STATUS} value={po.status} />
              <span className="text-ink-2">
                金额 <span className="font-semibold text-ink">{formatMoney(po.totalAmount)}</span>
              </span>
              <span className="text-ink-2">
                到货 {formatNumber(receivedQty)} / {formatNumber(totalQty)}
              </span>
              {invoiced > 0 && (
                <span className="text-ink-2">
                  已付 {formatMoney(paid)} / {formatMoney(invoiced)}
                </span>
              )}
            </>
          }
        />
        <StatusSteps
          steps={PURCHASE_STEPS}
          current={stepKey}
          aborted={s === "REJECTED" ? "审批被驳回" : s === "CANCELLED" ? "已取消" : null}
        />
        {s === "REJECTED" && current && (
          <div className="mt-3 rounded-md border border-tag-red bg-tag-red/40 px-3 py-2 text-sm text-tag-red-ink">
            驳回意见：{current.tasks.find((t) => t.status === "REJECTED")?.comment ?? "—"}
            {canEdit && "。可编辑采购单后重新提交审批。"}
          </div>
        )}

        <Properties>
          <Property label="供应商">
            <Link href={`/erp/suppliers/${po.supplierId}`} className="hover:underline">
              {po.supplier.name}
            </Link>
            {po.supplier.contact && <span className="ml-2 text-ink-3">{po.supplier.contact} {po.supplier.phone}</span>}
          </Property>
          <Property label="入库仓库">{po.warehouse.name}</Property>
          <Property label="预计到货">{formatDate(po.expectedDate)}</Property>
          <Property label="创建人">
            <UserChip name={po.createdBy.name} color={po.createdBy.avatarColor} />
          </Property>
          <Property label="创建时间">{formatDateTime(po.createdAt)}</Property>
          <Property label="审批单">
            {current ? (
              <Link href={`/oa/approvals/${current.id}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                {current.no}
                <ExternalLink className="size-3" />
              </Link>
            ) : (
              <span className="text-ink-3">未提交</span>
            )}
          </Property>
          <Property label="备注">{po.remark ?? "—"}</Property>
        </Properties>

        <Section title="采购明细">
          <Table>
            <THead>
              <TR>
                <TH>SKU</TH>
                <TH>产品</TH>
                <TH className="text-right">订购数量</TH>
                <TH className="text-right">已收数量</TH>
                <TH className="text-right">单价</TH>
                <TH className="text-right">小计</TH>
              </TR>
            </THead>
            <TBody>
              {po.items.map((i) => (
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
                  <TD className={`text-right tabular-nums ${i.receivedQty >= i.quantity ? "text-[#448361]" : i.receivedQty > 0 ? "text-[#cb912f]" : "text-ink-3"}`}>
                    {formatNumber(i.receivedQty)}
                  </TD>
                  <TD className="text-right tabular-nums">{formatMoney(i.price)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(i.quantity * i.price)}</TD>
                </TR>
              ))}
              <TR>
                <TD colSpan={5} className="text-right text-ink-2">
                  合计
                </TD>
                <TD className="text-right font-semibold tabular-nums">{formatMoney(po.totalAmount)}</TD>
              </TR>
            </TBody>
          </Table>
        </Section>

        <Section title="审批进度">
          {current ? (
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/oa/approvals/${current.id}`} className="font-medium text-accent hover:underline">
                  {current.no}
                </Link>
                <StatusBadge map={APPROVAL_STATUS} value={current.status} />
                <span className="text-ink-3">
                  {current.applicant.name} 提交于 {formatDateTime(current.createdAt)}
                  {current.finishedAt && ` · 结束于 ${formatDateTime(current.finishedAt)}`}
                </span>
              </div>
              <ol className="space-y-2">
                {current.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 text-ink-2">{t.stepName}</span>
                    <Avatar name={t.approver.name} color={t.approver.avatarColor} size={20} />
                    <span>{t.approver.name}</span>
                    <StatusBadge map={APPROVAL_TASK_STATUS} value={t.status} />
                    {t.actedAt && <span className="text-xs text-ink-3">{formatDateTime(t.actedAt)}</span>}
                    {t.comment && <span className="text-ink-2">「{t.comment}」</span>}
                  </li>
                ))}
                {current.status === "APPROVED" && current.tasks.length === 0 && <li className="text-sm text-ink-3">流程无审批节点，自动通过</li>}
              </ol>
              {history.length > 0 && (
                <div className="mt-3 border-t border-line pt-2 text-xs text-ink-3">
                  历史审批：
                  {history.map((h, i) => (
                    <span key={h.id}>
                      {i > 0 && "、"}
                      <Link href={`/oa/approvals/${h.id}`} className="hover:underline">
                        {h.no}（{APPROVAL_STATUS[h.status].label}）
                      </Link>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <p className="text-sm text-ink-3">尚未提交审批。提交后依次由部门主管、财务审核。</p>
          )}
        </Section>

        <Section title={`入库单 · ${po.inboundOrders.length}`}>
          <Table>
            <THead>
              <TR>
                <TH>入库单号</TH>
                <TH>状态</TH>
                <TH className="text-right">应收 / 实收</TH>
                <TH>预计到货</TH>
                <TH>收货时间</TH>
                <TH>备注</TH>
              </TR>
            </THead>
            <TBody>
              {po.inboundOrders.length === 0 && <TEmpty colSpan={6}>审批通过后自动生成入库单</TEmpty>}
              {po.inboundOrders.map((ib) => (
                <TR key={ib.id}>
                  <TD>
                    <Link href={`/wms/inbound/${ib.id}`} className="font-medium text-accent hover:underline">
                      {ib.no}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={INBOUND_STATUS} value={ib.status} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatNumber(ib.items.reduce((t, i) => t + i.expectedQty, 0))} / {formatNumber(ib.items.reduce((t, i) => t + i.receivedQty, 0))}
                  </TD>
                  <TD className="text-ink-2">{formatDate(ib.expectedDate)}</TD>
                  <TD className="text-ink-2">{formatDateTime(ib.receivedAt)}</TD>
                  <TD className="text-ink-2">{ib.remark ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section title="应付发票与付款">
          <InvoicePayments invoices={po.invoices} canPay={can(user, "finance:edit")} empty="仓库收货入库后自动生成应付发票" />
        </Section>

        <Section title="操作日志">
          <AuditTimeline logs={logs} labels={ERP_AUDIT_ACTION} />
        </Section>
      </Page>
    </>
  );
}
