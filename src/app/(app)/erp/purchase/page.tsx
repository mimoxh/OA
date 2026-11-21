import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma, PurchaseStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney } from "@/lib/format";
import { PURCHASE_STATUS } from "@/lib/labels";
import { oneOf, str } from "@/lib/erp/params";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { UserChip } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";

const STATUSES = Object.keys(PURCHASE_STATUS) as PurchaseStatus[];

export default async function PurchaseListPage({ searchParams }: PageProps<"/erp/purchase">) {
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const sp = await searchParams;
  const q = str(sp.q);
  const status = oneOf(str(sp.status), STATUSES);
  const search: Prisma.PurchaseOrderWhereInput = q
    ? { OR: [{ no: { contains: q } }, { supplier: { name: { contains: q } } }, { remark: { contains: q } }] }
    : {};
  const [orders, groups, total] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { ...search, ...(status ? { status } : {}) },
      include: { supplier: true, warehouse: true, createdBy: true, _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.purchaseOrder.groupBy({ by: ["status"], where: search, _count: { _all: true } }),
    db.purchaseOrder.count(),
  ]);
  const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Partial<Record<PurchaseStatus, number>>;
  const now = new Date();

  return (
    <>
      <TopBar
        crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "采购订单" }]}
        actions={
          canEdit && (
            <LinkButton href="/erp/purchase/new" variant="primary">
              <Plus className="size-3.5" />
              新建采购单
            </LinkButton>
          )
        }
      />
      <Page wide>
        <PageHeader icon="🛒" title="采购订单" description="草稿 → 提交审批 → 审批通过生成入库单 → 仓库收货生成应付 → 付款结清" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FilterPills
            options={STATUSES.filter((s) => counts[s]).map((s) => ({ value: s, label: PURCHASE_STATUS[s].label, count: counts[s] }))}
          />
          <SearchInput placeholder="搜索单号、供应商、备注…" />
        </div>
        {total === 0 ? (
          <EmptyState
            icon="🛒"
            title="还没有采购订单"
            description="创建采购单并提交审批，审批通过后会自动生成入库单"
            action={canEdit && <LinkButton href="/erp/purchase/new" variant="primary">新建采购单</LinkButton>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>单号</TH>
                <TH>供应商</TH>
                <TH>入库仓库</TH>
                <TH className="text-right">金额</TH>
                <TH>状态</TH>
                <TH>预计到货</TH>
                <TH>创建人</TH>
                <TH>日期</TH>
              </TR>
            </THead>
            <TBody>
              {orders.length === 0 && <TEmpty colSpan={8}>没有符合条件的采购单</TEmpty>}
              {orders.map((o) => {
                const late = o.expectedDate && o.expectedDate < now && (o.status === "APPROVED" || o.status === "PARTIAL_RECEIVED");
                return (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/erp/purchase/${o.id}`} className="font-medium hover:underline">
                        {o.no}
                      </Link>
                      <div className="text-xs text-ink-3">{o._count.items} 种产品</div>
                    </TD>
                    <TD>
                      <Link href={`/erp/suppliers/${o.supplierId}`} className="hover:underline">
                        {o.supplier.name}
                      </Link>
                    </TD>
                    <TD className="text-ink-2">{o.warehouse.name}</TD>
                    <TD className="text-right font-medium tabular-nums">{formatMoney(o.totalAmount)}</TD>
                    <TD>
                      <StatusBadge map={PURCHASE_STATUS} value={o.status} />
                    </TD>
                    <TD className={late ? "text-danger" : "text-ink-2"}>
                      {formatDate(o.expectedDate)}
                      {late && " · 逾期"}
                    </TD>
                    <TD>
                      <UserChip name={o.createdBy.name} color={o.createdBy.avatarColor} />
                    </TD>
                    <TD className="text-ink-2">{formatDate(o.createdAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Page>
    </>
  );
}
