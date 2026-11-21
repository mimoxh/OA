import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquarePlus, Pencil, Plus, ShoppingCart } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { TopBar, Page, PageHeader, Section, Card, StatCard } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { Button, LinkButton } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { TabsNav } from "@/components/ui/tabs";
import { INVOICE_STATUS, OPPORTUNITY_STAGE, PROJECT_STATUS, SALES_STATUS, TRANSPORT_STATUS } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { getActiveUsers } from "@/lib/crm/queries";
import { CustomerProperties } from "@/components/crm/customer-properties";
import { CustomerDialog } from "@/components/crm/customer-dialog";
import { DeleteCustomerButton } from "@/components/crm/customer-buttons";
import { ContactsPanel } from "@/components/crm/contacts";
import { FollowUpDialog, FollowUpTimeline } from "@/components/crm/followups";
import { OpportunityDialog } from "@/components/crm/opportunity-dialog";

const TABS = ["overview", "contacts", "opportunities", "followups", "orders", "receivables", "projects", "transport"] as const;

export default async function CustomerDetailPage({ params, searchParams }: PageProps<"/crm/customers/[id]">) {
  const user = await requireUser();
  const canEdit = can(user, "crm:edit");
  const canOrder = can(user, "erp:edit");
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as (typeof TABS)[number]) : "overview";

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, avatarColor: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      opportunities: { orderBy: { updatedAt: "desc" }, include: { owner: { select: { name: true, avatarColor: true } } } },
      followUps: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, avatarColor: true } }, opportunity: { select: { id: true, name: true } } },
      },
      salesOrders: { orderBy: { createdAt: "desc" }, include: { warehouse: { select: { name: true } } } },
      invoices: { where: { type: "RECEIVABLE" }, orderBy: { createdAt: "desc" } },
      projects: { orderBy: { createdAt: "desc" }, include: { owner: { select: { name: true, avatarColor: true } } } },
      transportOrders: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) notFound();
  const users = await getActiveUsers();

  const base = `/crm/customers/${id}`;
  const c = customer;
  const openOpps = c.opportunities.filter((o) => o.stage !== "WON" && o.stage !== "LOST");
  const orderTotal = c.salesOrders.filter((o) => o.status !== "CANCELLED").reduce((s, o) => s + o.totalAmount, 0);
  const unpaid = c.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL").reduce((s, i) => s + i.amount - i.paidAmount, 0);
  const oppOptions = c.opportunities.filter((o) => o.stage !== "LOST").map((o) => ({ id: o.id, name: o.name, customerId: c.id }));
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];

  const followUpButton = (
    <FollowUpDialog
      customerId={c.id}
      opportunities={oppOptions}
      trigger={
        <Button size="sm">
          <MessageSquarePlus className="size-3.5" />
          新增跟进
        </Button>
      }
    />
  );
  const newOppButton = (
    <OpportunityDialog
      customers={[{ id: c.id, name: c.name }]}
      users={users}
      customerId={c.id}
      defaultOwnerId={c.ownerId ?? user.id}
      trigger={
        <Button size="sm">
          <Plus className="size-3.5" />
          新建商机
        </Button>
      }
    />
  );

  return (
    <>
      <TopBar
        crumbs={[{ label: "CRM 客户", href: "/crm" }, { label: "客户", href: "/crm/customers" }, { label: c.name }]}
        actions={
          <>
            {canEdit && followUpButton}
            {canOrder && (
              <LinkButton href={`/erp/sales/new?customerId=${c.id}`}>
                <ShoppingCart className="size-3.5" />
                新建销售订单
              </LinkButton>
            )}
            {canEdit && (
              <CustomerDialog
                users={users}
                customerId={c.id}
                initial={{
                  name: c.name,
                  industry: c.industry ?? "",
                  level: c.level,
                  status: c.status,
                  source: c.source ?? "",
                  phone: c.phone ?? "",
                  email: c.email ?? "",
                  address: c.address ?? "",
                  remark: c.remark ?? "",
                  ownerId: c.ownerId ?? "",
                }}
                trigger={
                  <Button size="sm">
                    <Pencil className="size-3.5" />
                    编辑
                  </Button>
                }
              />
            )}
            {canEdit && <DeleteCustomerButton id={c.id} name={c.name} />}
          </>
        }
      />
      <Page>
        <PageHeader
          icon="🏢"
          title={c.name}
          description={
            <span className="font-mono text-sm">
              {c.code}
              {c.industry ? <span className="font-sans"> · {c.industry}</span> : null}
            </span>
          }
        />
        <CustomerProperties
          canEdit={canEdit}
          users={users}
          customer={{
            id: c.id,
            status: c.status,
            level: c.level,
            industry: c.industry,
            source: c.source,
            ownerId: c.ownerId,
            phone: c.phone,
            email: c.email,
            address: c.address,
            remark: c.remark,
            createdAt: c.createdAt,
          }}
        />

        <TabsNav
          className="mt-6"
          items={[
            { href: base, label: "概览", exact: true },
            { href: `${base}?tab=contacts`, label: "联系人", count: c.contacts.length },
            { href: `${base}?tab=opportunities`, label: "商机", count: c.opportunities.length },
            { href: `${base}?tab=followups`, label: "跟进记录", count: c.followUps.length },
            { href: `${base}?tab=orders`, label: "销售订单", count: c.salesOrders.length },
            { href: `${base}?tab=receivables`, label: "应收账款", count: c.invoices.length },
            { href: `${base}?tab=projects`, label: "项目", count: c.projects.length },
            { href: `${base}?tab=transport`, label: "运输", count: c.transportOrders.length },
          ]}
        />

        <div className="pt-5">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="进行中商机" value={formatMoney(openOpps.reduce((s, o) => s + o.amount, 0))} hint={`${openOpps.length} 个`} href={`${base}?tab=opportunities`} />
                <StatCard label="累计订单金额" value={formatMoney(orderTotal)} hint={`${c.salesOrders.length} 张订单`} href={`${base}?tab=orders`} />
                <StatCard label="未结应收" value={formatMoney(unpaid)} href={`${base}?tab=receivables`} />
                <StatCard label="跟进次数" value={c.followUps.length} hint={c.followUps[0] ? `最近 ${formatDate(c.followUps[0].createdAt)}` : "暂无"} href={`${base}?tab=followups`} />
              </div>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
                <div>
                  <Section title="进行中的商机" className="mt-0" actions={canEdit && newOppButton}>
                    <OpportunityTable rows={openOpps} empty="暂无进行中的商机" />
                  </Section>
                  <Section title="最近跟进" actions={<Link href={`${base}?tab=followups`} className="text-xs text-ink-2 hover:text-accent">全部 →</Link>}>
                    <FollowUpTimeline items={c.followUps.slice(0, 4)} currentUserId={user.id} canEdit={canEdit} />
                  </Section>
                </div>
                <Section title="首要联系人" className="mt-0">
                  <Card className="p-3 text-sm">
                    {primary ? (
                      <div className="space-y-1">
                        <div className="font-medium">
                          {primary.name} <span className="font-normal text-ink-2">{primary.title}</span>
                        </div>
                        <div className="text-ink-2">📞 {primary.phone ?? "—"}</div>
                        <div className="text-ink-2">✉️ {primary.email ?? "—"}</div>
                      </div>
                    ) : (
                      <span className="text-ink-3">暂无联系人</span>
                    )}
                    <Link href={`${base}?tab=contacts`} className="mt-2 block text-xs text-accent hover:underline">
                      管理联系人（{c.contacts.length}）
                    </Link>
                  </Card>
                </Section>
              </div>
            </>
          )}

          {tab === "contacts" && <ContactsPanel customerId={c.id} contacts={c.contacts} canEdit={canEdit} />}

          {tab === "opportunities" && (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-ink-2">共 {c.opportunities.length} 个商机</span>
                {canEdit && newOppButton}
              </div>
              <OpportunityTable rows={c.opportunities} empty="还没有商机" />
            </>
          )}

          {tab === "followups" && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm text-ink-2">共 {c.followUps.length} 条跟进</span>
                {canEdit && followUpButton}
              </div>
              <FollowUpTimeline items={c.followUps} currentUserId={user.id} canEdit={canEdit} />
            </>
          )}

          {tab === "orders" && (
            <>
              {canOrder && (
                <div className="mb-2 flex justify-end">
                  <LinkButton href={`/erp/sales/new?customerId=${c.id}`}>
                    <ShoppingCart className="size-3.5" />
                    新建销售订单
                  </LinkButton>
                </div>
              )}
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
                  {c.salesOrders.length === 0 && <TEmpty colSpan={5}>暂无销售订单</TEmpty>}
                  {c.salesOrders.map((o) => (
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
            </>
          )}

          {tab === "receivables" && (
            <Table>
              <THead>
                <TR>
                  <TH>发票号</TH>
                  <TH>说明</TH>
                  <TH>到期日</TH>
                  <TH>状态</TH>
                  <TH className="text-right">金额</TH>
                  <TH className="text-right">已收</TH>
                  <TH className="text-right">未收</TH>
                </TR>
              </THead>
              <TBody>
                {c.invoices.length === 0 && <TEmpty colSpan={7}>暂无应收账款</TEmpty>}
                {c.invoices.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-mono text-[13px]">{i.no}</TD>
                    <TD className="text-ink-2">{i.memo ?? "—"}</TD>
                    <TD className={i.dueDate && i.dueDate < new Date() && i.status !== "PAID" ? "text-danger" : "text-ink-2"}>{formatDate(i.dueDate)}</TD>
                    <TD>
                      <StatusBadge map={INVOICE_STATUS} value={i.status} />
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(i.amount)}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{formatMoney(i.paidAmount)}</TD>
                    <TD className="text-right font-medium tabular-nums">{formatMoney(i.amount - i.paidAmount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {tab === "projects" && (
            <Table>
              <THead>
                <TR>
                  <TH>项目</TH>
                  <TH>编码</TH>
                  <TH>状态</TH>
                  <TH>负责人</TH>
                  <TH>周期</TH>
                </TR>
              </THead>
              <TBody>
                {c.projects.length === 0 && <TEmpty colSpan={5}>暂无关联项目</TEmpty>}
                {c.projects.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/pms/projects/${p.id}`} className="font-medium hover:text-accent hover:underline">
                        {p.icon} {p.name}
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs text-ink-2">{p.code}</TD>
                    <TD>
                      <StatusBadge map={PROJECT_STATUS} value={p.status} />
                    </TD>
                    <TD>
                      <UserChip name={p.owner.name} color={p.owner.avatarColor} />
                    </TD>
                    <TD className="text-ink-2">
                      {formatDate(p.startDate)} ~ {formatDate(p.endDate)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {tab === "transport" && (
            <Table>
              <THead>
                <TR>
                  <TH>运输单号</TH>
                  <TH>起点 → 终点</TH>
                  <TH>收货人</TH>
                  <TH>计划时间</TH>
                  <TH>状态</TH>
                </TR>
              </THead>
              <TBody>
                {c.transportOrders.length === 0 && <TEmpty colSpan={5}>暂无运输记录</TEmpty>}
                {c.transportOrders.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <Link href={`/tms/orders/${t.id}`} className="font-mono text-[13px] hover:text-accent hover:underline">
                        {t.no}
                      </Link>
                    </TD>
                    <TD className="text-ink-2">
                      {t.origin} → {t.destination}
                    </TD>
                    <TD className="text-ink-2">{t.consignee ?? "—"}</TD>
                    <TD className="text-ink-2">{formatDate(t.plannedAt, "yyyy-MM-dd HH:mm")}</TD>
                    <TD>
                      <StatusBadge map={TRANSPORT_STATUS} value={t.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </Page>
    </>
  );
}

function OpportunityTable({
  rows,
  empty,
}: {
  rows: {
    id: string;
    name: string;
    amount: number;
    stage: keyof typeof OPPORTUNITY_STAGE;
    probability: number;
    expectedCloseDate: Date | null;
    owner: { name: string; avatarColor: string } | null;
  }[];
  empty: string;
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>商机</TH>
          <TH>阶段</TH>
          <TH className="text-right">金额</TH>
          <TH className="text-right">赢率</TH>
          <TH>预计成交</TH>
          <TH>负责人</TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 && <TEmpty colSpan={6}>{empty}</TEmpty>}
        {rows.map((o) => (
          <TR key={o.id}>
            <TD>
              <Link href={`/crm/opportunities/${o.id}`} className="font-medium hover:text-accent hover:underline">
                {o.name}
              </Link>
            </TD>
            <TD>
              <StatusBadge map={OPPORTUNITY_STAGE} value={o.stage} />
            </TD>
            <TD className="text-right tabular-nums">{formatMoney(o.amount)}</TD>
            <TD className="text-right tabular-nums text-ink-2">
              <Badge color="gray">{o.probability}%</Badge>
            </TD>
            <TD className="text-ink-2">{formatDate(o.expectedCloseDate)}</TD>
            <TD>
              <UserChip name={o.owner?.name} color={o.owner?.avatarColor} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
