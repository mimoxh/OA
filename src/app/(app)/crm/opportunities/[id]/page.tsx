import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { db } from "@/lib/db";
import { can, isAppEnabled, requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { SALES_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { getActiveUsers } from "@/lib/crm/queries";
import { StageProgress } from "@/components/crm/stage-progress";
import { OpportunityProperties } from "@/components/crm/opportunity-properties";
import { FollowUpDialog, FollowUpTimeline } from "@/components/crm/followups";
import { ConvertOrderDialog } from "@/components/crm/convert-order-dialog";
import { DeleteOpportunityButton } from "@/components/crm/opportunity-buttons";
import { BizGroupButton } from "@/components/im/biz-group-button";
import { bizDirectKey } from "@/lib/im/biz";

const ACTION_LABEL: Record<string, string> = {
  created: "创建了商机",
  updated: "更新了商机",
  stage_changed: "变更阶段",
};

export default async function OpportunityDetailPage({ params }: PageProps<"/crm/opportunities/[id]">) {
  const user = await requireUser();
  const canEdit = can(user, "crm:edit");
  const canConvert = can(user, "erp:edit") && (await isAppEnabled("erp"));
  const { id } = await params;
  const opp = await db.opportunity.findUnique({
    where: { id },
    include: {
      customer: { include: { contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } },
      followUps: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, avatarColor: true } } },
      },
      salesOrders: { orderBy: { createdAt: "desc" }, include: { warehouse: { select: { name: true } } } },
    },
  });
  if (!opp) notFound();

  const [users, logs, warehouses, products, inventories, bizGroup] = await Promise.all([
    getActiveUsers(),
    db.auditLog.findMany({
      where: { entityType: "opportunity", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { name: true, avatarColor: true } } },
    }),
    canConvert ? db.warehouse.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { code: "asc" } }) : [],
    canConvert
      ? db.product.findMany({ where: { active: true }, select: { id: true, name: true, sku: true, unit: true, price: true }, orderBy: { sku: "asc" } })
      : [],
    canConvert ? db.inventory.findMany({ select: { productId: true, warehouseId: true, quantity: true, reservedQty: true } }) : [],
    db.conversation.findUnique({ where: { directKey: bizDirectKey("opportunity", id) }, select: { id: true } }),
  ]);
  const stock: Record<string, Record<string, number>> = {};
  for (const inv of inventories) (stock[inv.warehouseId] ??= {})[inv.productId] = inv.quantity - inv.reservedQty;
  const primary = opp.customer.contacts.find((c) => c.isPrimary) ?? opp.customer.contacts[0];

  const followUpButton = canEdit && (
    <FollowUpDialog
      customerId={opp.customerId}
      opportunities={[{ id: opp.id, name: opp.name, customerId: opp.customerId }]}
      defaultOpportunityId={opp.id}
      trigger={
        <Button size="sm">
          <MessageSquarePlus className="size-3.5" />
          新增跟进
        </Button>
      }
    />
  );
  const convertButton = canConvert && opp.stage !== "LOST" && (
    <ConvertOrderDialog
      opportunity={{ id: opp.id, name: opp.name, amount: opp.amount }}
      defaults={{
        shippingAddress: opp.customer.address ?? "",
        consignee: primary?.name ?? opp.customer.name,
        consigneePhone: primary?.phone ?? opp.customer.phone ?? "",
      }}
      warehouses={warehouses}
      products={products}
      stock={stock}
    />
  );
  const bizGroupButton = <BizGroupButton bizType="opportunity" bizId={opp.id} existingConversationId={bizGroup?.id} />;

  return (
    <>
      <TopBar
        crumbs={[{ label: "CRM 客户", href: "/crm" }, { label: "商机", href: "/crm/opportunities" }, { label: opp.name }]}
        mobileActions={followUpButton}
        mobileMore={
          <>
            {bizGroupButton}
            {convertButton}
            {canEdit && <DeleteOpportunityButton id={opp.id} name={opp.name} />}
          </>
        }
        actions={
          <>
            {bizGroupButton}
            {followUpButton}
            {canEdit && <DeleteOpportunityButton id={opp.id} name={opp.name} />}
            {convertButton}
          </>
        }
      />
      <Page>
        <PageHeader
          icon="💡"
          title={opp.name}
          description={
            <Link href={`/crm/customers/${opp.customer.id}`} className="hover:text-accent">
              {opp.customer.name}
            </Link>
          }
        />
        <StageProgress id={opp.id} stage={opp.stage} lostReason={opp.lostReason} canEdit={canEdit} />
        <div className="mt-4">
          <OpportunityProperties
            canEdit={canEdit}
            users={users}
            opp={{
              id: opp.id,
              amount: opp.amount,
              stage: opp.stage,
              probability: opp.probability,
              expectedCloseDate: opp.expectedCloseDate,
              ownerId: opp.ownerId,
              customer: { id: opp.customer.id, name: opp.customer.name },
            }}
          />
        </div>

        <Section title={`关联销售订单（${opp.salesOrders.length}）`}>
          <Table>
            <THead>
              <TR>
                <TH>订单号</TH>
                <TH>下单日期</TH>
                <TH>发货仓库</TH>
                <TH>状态</TH>
                <TH className="text-right">金额</TH>
              </TR>
            </THead>
            <TBody>
              {opp.salesOrders.length === 0 && (
                <TEmpty colSpan={5}>{canConvert && opp.stage !== "LOST" ? "尚未转化，点击右上角「转为销售订单」" : "暂无关联订单"}</TEmpty>
              )}
              {opp.salesOrders.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/erp/sales/${o.id}`} className="font-mono text-[13px] hover:text-accent hover:underline">
                      {o.no}
                    </Link>
                  </TD>
                  <TD className="text-ink-2">{formatDate(o.orderDate)}</TD>
                  <TD className="text-ink-2">{o.warehouse.name}</TD>
                  <TD>
                    <StatusBadge map={SALES_STATUS} value={o.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{formatMoney(o.totalAmount)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_260px]">
          <Section title={`跟进记录（${opp.followUps.length}）`}>
            <FollowUpTimeline items={opp.followUps} currentUserId={user.id} canEdit={canEdit} empty="还没有针对该商机的跟进" />
          </Section>
          <Section title="活动">
            <ol className="space-y-3 text-[13px]">
              {logs.length === 0 && <li className="text-ink-3">暂无活动</li>}
              {logs.map((l) => (
                <li key={l.id} className="flex gap-2">
                  <Avatar name={l.user?.name ?? "系统"} color={l.user?.avatarColor} size={18} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-ink">
                      <span className="font-medium">{l.user?.name ?? "系统"}</span> {ACTION_LABEL[l.action] ?? l.action}
                    </div>
                    {l.action === "stage_changed" && l.detail && <div className="text-ink-2">{l.detail}</div>}
                    <div className="text-xs text-ink-3" title={formatDateTime(l.createdAt)}>
                      {formatRelative(l.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </Page>
    </>
  );
}
