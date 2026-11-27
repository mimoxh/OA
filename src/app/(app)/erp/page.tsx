import Link from "next/link";
import { AlertTriangle, ClipboardList, PackageCheck, ShoppingCart, TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { PURCHASE_STATUS, SALES_STATUS } from "@/lib/labels";
import { bucketIndex, lastMonths, round2 } from "@/lib/erp/params";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, Page, PageHeader, Section, StatCard, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { TrendChart } from "@/components/erp/trend-chart";
import { MobileCard, MobileField, MobileList } from "@/components/mobile/mobile-list";
import { ModuleEntries } from "@/components/mobile/module-entries";

export default async function ErpOverviewPage() {
  const user = await requireUser();
  const months = lastMonths(6);
  const from = months[0].start;
  const thisMonth = months[months.length - 1];
  const [sales, purchases, soGroups, poGroups, soldItems, products, stock, recentSales, recentPurchases] = await Promise.all([
    db.salesOrder.findMany({
      where: { status: { notIn: ["DRAFT", "CANCELLED"] }, orderDate: { gte: from } },
      select: { orderDate: true, totalAmount: true },
    }),
    db.purchaseOrder.findMany({
      where: { status: { notIn: ["DRAFT", "CANCELLED", "REJECTED", "PENDING_APPROVAL"] }, createdAt: { gte: from } },
      select: { createdAt: true, totalAmount: true },
    }),
    db.salesOrder.groupBy({ by: ["status"], _count: { _all: true } }),
    db.purchaseOrder.groupBy({ by: ["status"], _count: { _all: true } }),
    db.salesOrderItem.findMany({
      where: { order: { status: { notIn: ["DRAFT", "CANCELLED"] } } },
      select: { productId: true, quantity: true, price: true },
    }),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.inventory.groupBy({ by: ["productId"], _sum: { quantity: true, reservedQty: true } }),
    db.salesOrder.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { customer: { select: { name: true } } } }),
    db.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { supplier: { select: { name: true } } } }),
  ]);

  const trend = months.map((m) => ({ label: m.label, sales: 0, purchase: 0 }));
  for (const s of sales) {
    const i = bucketIndex(months, s.orderDate);
    if (i >= 0) trend[i].sales = round2(trend[i].sales + s.totalAmount);
  }
  for (const p of purchases) {
    const i = bucketIndex(months, p.createdAt);
    if (i >= 0) trend[i].purchase = round2(trend[i].purchase + p.totalAmount);
  }
  const prev = trend[trend.length - 2];
  const cur = trend[trend.length - 1];
  const soCount = Object.fromEntries(soGroups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const poCount = Object.fromEntries(poGroups.map((g) => [g.status, g._count._all])) as Record<string, number>;

  const productMap = new Map(products.map((p) => [p.id, p]));
  const hot = new Map<string, { qty: number; amount: number }>();
  for (const it of soldItems) {
    const h = hot.get(it.productId) ?? { qty: 0, amount: 0 };
    h.qty += it.quantity;
    h.amount += it.quantity * it.price;
    hot.set(it.productId, h);
  }
  const top = [...hot.entries()]
    .filter(([id]) => productMap.has(id))
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 5);
  const topMax = top[0]?.[1].amount ?? 1;

  const stockMap = new Map(stock.map((s) => [s.productId, s._sum]));
  const low = products
    .map((p) => ({ p, qty: stockMap.get(p.id)?.quantity ?? 0, reserved: stockMap.get(p.id)?.reservedQty ?? 0 }))
    .filter((x) => x.p.safetyStock > 0 && x.qty < x.p.safetyStock)
    .sort((a, b) => a.qty / a.p.safetyStock - b.qty / b.p.safetyStock);

  const growth = prev.sales > 0 ? Math.round(((cur.sales - prev.sales) / prev.sales) * 100) : null;

  return (
    <>
      <TopBar
        mobileTitle="ERP 企业资源"
        crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "经营概览" }]}
        mobileActions={
          <LinkButton href="/erp/sales/new" variant="primary">
            新建销售单
          </LinkButton>
        }
        mobileMore={<LinkButton href="/erp/purchase/new">新建采购单</LinkButton>}
        actions={
          <>
            <LinkButton href="/erp/purchase/new">新建采购单</LinkButton>
            <LinkButton href="/erp/sales/new" variant="primary">
              新建销售单
            </LinkButton>
          </>
        }
      />
      <Page wide>
        <PageHeader icon="🏢" title="经营概览" description={`${thisMonth.start.getFullYear()} 年 ${thisMonth.label}经营数据与库存预警`} />
        <ModuleEntries moduleKey="erp" permissions={user.permissions} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="本月销售额"
            icon={<TrendingUp />}
            value={formatMoney(cur.sales)}
            hint={growth === null ? "已确认订单金额" : `较上月 ${growth >= 0 ? "+" : ""}${growth}%`}
            href="/erp/sales"
          />
          <StatCard label="本月采购额" icon={<ShoppingCart />} value={formatMoney(cur.purchase)} hint="已审批采购单金额" href="/erp/purchase" />
          <StatCard
            label="待确认 / 待发货销售单"
            icon={<ClipboardList />}
            value={
              <span>
                {soCount.DRAFT ?? 0}
                <span className="mx-1 text-ink-3">/</span>
                {soCount.CONFIRMED ?? 0}
              </span>
            }
            hint="草稿待确认 · 已确认待出库"
            href="/erp/sales?status=CONFIRMED"
          />
          <StatCard
            label="待审批 / 待入库采购单"
            icon={<PackageCheck />}
            value={
              <span>
                {poCount.PENDING_APPROVAL ?? 0}
                <span className="mx-1 text-ink-3">/</span>
                {(poCount.APPROVED ?? 0) + (poCount.PARTIAL_RECEIVED ?? 0)}
              </span>
            }
            hint="审批中 · 已审批待收货"
            href="/erp/purchase?status=PENDING_APPROVAL"
          />
        </div>

        <Section title="近 6 个月销售与采购趋势">
          <Card className="p-4">
            <TrendChart
              data={trend}
              series={[
                { key: "sales", name: "销售额", color: "#2383e2" },
                { key: "purchase", name: "采购额", color: "#e8a250" },
              ]}
            />
          </Card>
        </Section>

        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          <Section title="热销产品 Top 5" actions={<LinkButton href="/erp/products" variant="ghost" size="xs">全部产品</LinkButton>}>
            {top.length ? (
              <div className="space-y-2.5 pt-1">
                {top.map(([id, v], i) => {
                  const p = productMap.get(id)!;
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <span className="w-4 text-center text-sm font-semibold text-ink-3">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <Link href={`/erp/products/${id}`} className="truncate hover:underline">
                            {p.name}
                          </Link>
                          <span className="shrink-0 tabular-nums text-ink-2">
                            {formatNumber(v.qty)} {p.unit} · {formatMoney(v.amount)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-hover">
                          <div className="h-1.5 rounded-full bg-accent/80" style={{ width: `${Math.max(4, (v.amount / topMax) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-ink-3">暂无销售数据</p>
            )}
          </Section>

          <Section
            title={
              <span className="flex items-center gap-1.5">
                库存预警
                {low.length > 0 && <Badge color="red">{low.length}</Badge>}
              </span>
            }
            actions={<LinkButton href="/wms/inventory" variant="ghost" size="xs">查看库存</LinkButton>}
          >
            <MobileList empty="所有产品库存均高于安全库存 👍">
              {low.slice(0, 6).map(({ p, qty, reserved }) => (
                <MobileCard
                  key={p.id}
                  href={`/erp/products/${p.id}`}
                  icon={<AlertTriangle className="size-4 text-[#d9730d]" />}
                  title={p.name}
                  meta={
                    <>
                      <MobileField label="库存">
                        <span className="text-danger">{formatNumber(qty)}</span>
                      </MobileField>
                      <MobileField label="预占">{formatNumber(reserved)}</MobileField>
                      <MobileField label="安全">{formatNumber(p.safetyStock)}</MobileField>
                    </>
                  }
                  aside={
                    <span className="text-[13px] font-normal text-ink-2">
                      缺 <span className="font-medium text-danger">{formatNumber(p.safetyStock - qty)}</span> {p.unit}
                    </span>
                  }
                />
              ))}
            </MobileList>
            <Table className="max-md:hidden">
              <THead>
                <TR>
                  <TH>产品</TH>
                  <TH className="text-right">总库存</TH>
                  <TH className="text-right">已预占</TH>
                  <TH className="text-right">安全库存</TH>
                  <TH className="text-right">缺口</TH>
                </TR>
              </THead>
              <TBody>
                {low.length === 0 && <TEmpty colSpan={5}>所有产品库存均高于安全库存 👍</TEmpty>}
                {low.slice(0, 6).map(({ p, qty, reserved }) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/erp/products/${p.id}`} className="flex items-center gap-1.5 hover:underline">
                        <AlertTriangle className="size-3.5 shrink-0 text-[#d9730d]" />
                        <span className="truncate">{p.name}</span>
                      </Link>
                    </TD>
                    <TD className="text-right tabular-nums text-danger">{formatNumber(qty)}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{formatNumber(reserved)}</TD>
                    <TD className="text-right tabular-nums">{formatNumber(p.safetyStock)}</TD>
                    <TD className="text-right tabular-nums">
                      <Link href="/wms/inventory" className="text-accent hover:underline">
                        {formatNumber(p.safetyStock - qty)} {p.unit}
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          <Section title="最近销售订单" actions={<LinkButton href="/erp/sales" variant="ghost" size="xs">全部</LinkButton>}>
            <MobileList empty="暂无销售订单">
              {recentSales.map((o) => (
                <MobileCard
                  key={o.id}
                  href={`/erp/sales/${o.id}`}
                  title={o.customer.name}
                  badge={<StatusBadge map={SALES_STATUS} value={o.status} />}
                  subtitle={`${o.no} · ${formatDate(o.orderDate, "MM-dd")}`}
                  aside={formatMoney(o.totalAmount)}
                />
              ))}
            </MobileList>
            <Table className="max-md:hidden">
              <TBody>
                {recentSales.length === 0 && <TEmpty colSpan={4}>暂无销售订单</TEmpty>}
                {recentSales.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/erp/sales/${o.id}`} className="font-medium hover:underline">
                        {o.no}
                      </Link>
                      <div className="truncate text-xs text-ink-3">{o.customer.name}</div>
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(o.totalAmount)}</TD>
                    <TD className="text-ink-2">{formatDate(o.orderDate, "MM-dd")}</TD>
                    <TD className="text-right">
                      <StatusBadge map={SALES_STATUS} value={o.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          <Section title="最近采购订单" actions={<LinkButton href="/erp/purchase" variant="ghost" size="xs">全部</LinkButton>}>
            <MobileList empty="暂无采购订单">
              {recentPurchases.map((o) => (
                <MobileCard
                  key={o.id}
                  href={`/erp/purchase/${o.id}`}
                  title={o.supplier.name}
                  badge={<StatusBadge map={PURCHASE_STATUS} value={o.status} />}
                  subtitle={`${o.no} · ${formatDate(o.createdAt, "MM-dd")}`}
                  aside={formatMoney(o.totalAmount)}
                />
              ))}
            </MobileList>
            <Table className="max-md:hidden">
              <TBody>
                {recentPurchases.length === 0 && <TEmpty colSpan={4}>暂无采购订单</TEmpty>}
                {recentPurchases.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/erp/purchase/${o.id}`} className="font-medium hover:underline">
                        {o.no}
                      </Link>
                      <div className="truncate text-xs text-ink-3">{o.supplier.name}</div>
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(o.totalAmount)}</TD>
                    <TD className="text-ink-2">{formatDate(o.createdAt, "MM-dd")}</TD>
                    <TD className="text-right">
                      <StatusBadge map={PURCHASE_STATUS} value={o.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </div>
      </Page>
    </>
  );
}
