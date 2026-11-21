import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma, SalesStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney } from "@/lib/format";
import { SALES_STATUS } from "@/lib/labels";
import { oneOf, str } from "@/lib/erp/params";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";

const STATUSES = Object.keys(SALES_STATUS) as SalesStatus[];

export default async function SalesListPage({ searchParams }: PageProps<"/erp/sales">) {
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const sp = await searchParams;
  const q = str(sp.q);
  const status = oneOf(str(sp.status), STATUSES);
  const search: Prisma.SalesOrderWhereInput = q
    ? {
        OR: [
          { no: { contains: q } },
          { customer: { name: { contains: q } } },
          { consignee: { contains: q } },
          { remark: { contains: q } },
        ],
      }
    : {};
  const [orders, groups, total] = await Promise.all([
    db.salesOrder.findMany({
      where: { ...search, ...(status ? { status } : {}) },
      include: {
        customer: true,
        warehouse: true,
        createdBy: true,
        opportunity: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    }),
    db.salesOrder.groupBy({ by: ["status"], where: search, _count: { _all: true } }),
    db.salesOrder.count(),
  ]);
  const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Partial<Record<SalesStatus, number>>;

  return (
    <>
      <TopBar
        crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "销售订单" }]}
        actions={
          canEdit && (
            <LinkButton href="/erp/sales/new" variant="primary">
              <Plus className="size-3.5" />
              新建销售单
            </LinkButton>
          )
        }
      />
      <Page wide>
        <PageHeader icon="🧾" title="销售订单" description="草稿 → 确认预占库存 → 仓库发货 → 运输签收生成应收 → 收款完成" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FilterPills options={STATUSES.filter((s) => counts[s]).map((s) => ({ value: s, label: SALES_STATUS[s].label, count: counts[s] }))} />
          <SearchInput placeholder="搜索单号、客户、收货人…" />
        </div>
        {total === 0 ? (
          <EmptyState
            icon="🧾"
            title="还没有销售订单"
            description="可在 CRM 商机中转化，或直接新建销售订单"
            action={canEdit && <LinkButton href="/erp/sales/new" variant="primary">新建销售单</LinkButton>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>单号</TH>
                <TH>客户</TH>
                <TH>发货仓库</TH>
                <TH className="text-right">金额</TH>
                <TH>状态</TH>
                <TH>收货人</TH>
                <TH>创建人</TH>
                <TH>下单日期</TH>
              </TR>
            </THead>
            <TBody>
              {orders.length === 0 && <TEmpty colSpan={8}>没有符合条件的销售订单</TEmpty>}
              {orders.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/erp/sales/${o.id}`} className="font-medium hover:underline">
                      {o.no}
                    </Link>
                    <div className="max-w-56 truncate text-xs text-ink-3">
                      {o._count.items} 种产品{o.opportunity && ` · 商机：${o.opportunity.name}`}
                    </div>
                  </TD>
                  <TD>
                    <Link href={`/crm/customers/${o.customerId}`} className="hover:underline">
                      {o.customer.name}
                    </Link>
                  </TD>
                  <TD className="text-ink-2">{o.warehouse.name}</TD>
                  <TD className="text-right font-medium tabular-nums">{formatMoney(o.totalAmount)}</TD>
                  <TD>
                    <StatusBadge map={SALES_STATUS} value={o.status} />
                  </TD>
                  <TD className="text-ink-2">{o.consignee ?? "—"}</TD>
                  <TD>
                    <UserChip name={o.createdBy.name} color={o.createdBy.avatarColor} />
                  </TD>
                  <TD className="text-ink-2">{formatDate(o.orderDate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>
    </>
  );
}
