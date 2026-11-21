import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { MOVEMENT_TYPE, PURCHASE_STATUS, SALES_STATUS } from "@/lib/labels";
import { movementRefHref } from "@/lib/erp/labels";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/ui/avatar";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { ProductDialog } from "@/components/erp/product-dialog";
import { ActionButton } from "@/components/erp/action-button";
import { setProductActive } from "@/app/(app)/erp/actions";

export default async function ProductDetailPage({ params }: PageProps<"/erp/products/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const product = await db.product.findUnique({
    where: { id },
    include: {
      inventories: { include: { warehouse: true, location: true }, orderBy: { warehouse: { code: "asc" } } },
      stockMovements: { include: { warehouse: true, user: true }, orderBy: { createdAt: "desc" }, take: 20 },
      purchaseItems: {
        include: { order: { include: { supplier: true } } },
        orderBy: { order: { createdAt: "desc" } },
        take: 8,
      },
      salesItems: {
        include: { order: { include: { customer: true } } },
        orderBy: { order: { orderDate: "desc" } },
        take: 8,
      },
    },
  });
  if (!product) notFound();
  const cats = await db.product.findMany({ distinct: ["category"], select: { category: true } });
  const categories = cats.map((c) => c.category).filter((c): c is string => !!c);

  const qty = product.inventories.reduce((s, i) => s + i.quantity, 0);
  const reserved = product.inventories.reduce((s, i) => s + i.reservedQty, 0);
  const margin = product.price > 0 ? Math.round(((product.price - product.cost) / product.price) * 1000) / 10 : 0;
  const low = product.safetyStock > 0 && qty < product.safetyStock;

  return (
    <>
      <TopBar
        crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "产品", href: "/erp/products" }, { label: product.name }]}
        actions={
          canEdit && (
            <>
              <ActionButton
                action={setProductActive.bind(null, product.id, !product.active)}
                success={product.active ? "产品已停用" : "产品已启用"}
                confirm={product.active ? { title: `停用「${product.name}」？`, description: "停用后不能在新单据中选择该产品。" } : undefined}
                danger={product.active}
                confirmText="停用"
              >
                {product.active ? "停用" : "启用"}
              </ActionButton>
              <ProductDialog categories={categories} product={product} trigger={<Button variant="primary">编辑</Button>} />
            </>
          )
        }
      />
      <Page>
        <PageHeader
          icon="📦"
          title={product.name}
          description={product.spec ?? undefined}
          meta={
            <>
              <span className="font-mono text-xs text-ink-2">{product.sku}</span>
              {product.active ? <Badge color="green">在售</Badge> : <Badge>已停用</Badge>}
              {low && <Badge color="orange">低于安全库存</Badge>}
            </>
          }
        />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_280px]">
          <Properties>
            <Property label="分类">{product.category ?? "—"}</Property>
            <Property label="单位">{product.unit}</Property>
            <Property label="售价">{formatMoney(product.price)}</Property>
            <Property label="成本（加权平均）">{formatMoney(product.cost)}</Property>
            <Property label="毛利率">{product.price > 0 ? `${margin}%` : "—"}</Property>
            <Property label="单位重量">{product.weight} kg</Property>
            <Property label="安全库存">
              {formatNumber(product.safetyStock)} {product.unit}
            </Property>
            <Property label="创建时间">{formatDateTime(product.createdAt)}</Property>
          </Properties>
          <div className="grid grid-cols-2 gap-2 self-start">
            {[
              ["总库存", qty],
              ["可用", qty - reserved],
              ["已预占", reserved],
              ["库存金额", null],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded-lg border border-line p-3">
                <div className="text-xs text-ink-2">{label}</div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${label === "总库存" && low ? "text-danger" : ""}`}>
                  {v === null ? formatMoney(qty * product.cost) : formatNumber(v as number)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Section title="各仓库库存" actions={<Link href="/wms/inventory" className="text-xs text-ink-2 hover:text-ink">WMS 库存 →</Link>}>
          <Table>
            <THead>
              <TR>
                <TH>仓库</TH>
                <TH>默认库位</TH>
                <TH className="text-right">库存数量</TH>
                <TH className="text-right">已预占</TH>
                <TH className="text-right">可用</TH>
                <TH>更新时间</TH>
              </TR>
            </THead>
            <TBody>
              {product.inventories.length === 0 && <TEmpty colSpan={6}>暂无库存</TEmpty>}
              {product.inventories.map((i) => (
                <TR key={i.id}>
                  <TD>{i.warehouse.name}</TD>
                  <TD className="text-ink-2">{i.location?.code ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(i.quantity)}</TD>
                  <TD className="text-right tabular-nums text-ink-2">{formatNumber(i.reservedQty)}</TD>
                  <TD className="text-right font-medium tabular-nums">{formatNumber(i.quantity - i.reservedQty)}</TD>
                  <TD className="text-ink-2">{formatDateTime(i.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>

        <Section title="最近库存流水" actions={<Link href="/wms/movements" className="text-xs text-ink-2 hover:text-ink">全部流水 →</Link>}>
          <Table>
            <THead>
              <TR>
                <TH>时间</TH>
                <TH>类型</TH>
                <TH>仓库</TH>
                <TH className="text-right">变动</TH>
                <TH className="text-right">结存</TH>
                <TH>关联单据</TH>
                <TH>说明</TH>
                <TH>操作人</TH>
              </TR>
            </THead>
            <TBody>
              {product.stockMovements.length === 0 && <TEmpty colSpan={8}>暂无库存流水</TEmpty>}
              {product.stockMovements.map((m) => {
                const href = movementRefHref(m.refType, m.refId);
                return (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap text-ink-2">{formatDateTime(m.createdAt)}</TD>
                    <TD>
                      <StatusBadge map={MOVEMENT_TYPE} value={m.type} />
                    </TD>
                    <TD>{m.warehouse.name}</TD>
                    <TD className={`text-right tabular-nums ${m.quantity > 0 ? "text-[#448361]" : "text-danger"}`}>
                      {m.quantity > 0 ? "+" : ""}
                      {formatNumber(m.quantity)}
                    </TD>
                    <TD className="text-right tabular-nums">{formatNumber(m.balance)}</TD>
                    <TD>
                      {href ? (
                        <Link href={href} className="text-accent hover:underline">
                          {m.refNo ?? "查看"}
                        </Link>
                      ) : (
                        <span className="text-ink-3">{m.refNo ?? "—"}</span>
                      )}
                    </TD>
                    <TD className="text-ink-2">{m.memo ?? "—"}</TD>
                    <TD>
                      <UserChip name={m.user?.name} color={m.user?.avatarColor} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>

        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
          <Section title="最近采购">
            <Table>
              <THead>
                <TR>
                  <TH>采购单</TH>
                  <TH className="text-right">数量</TH>
                  <TH className="text-right">单价</TH>
                  <TH>状态</TH>
                </TR>
              </THead>
              <TBody>
                {product.purchaseItems.length === 0 && <TEmpty colSpan={4}>暂无采购记录</TEmpty>}
                {product.purchaseItems.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <Link href={`/erp/purchase/${i.order.id}`} className="font-medium hover:underline">
                        {i.order.no}
                      </Link>
                      <div className="truncate text-xs text-ink-3">
                        {i.order.supplier.name} · {formatDate(i.order.createdAt)}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums">{formatNumber(i.quantity)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(i.price)}</TD>
                    <TD>
                      <StatusBadge map={PURCHASE_STATUS} value={i.order.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          <Section title="最近销售">
            <Table>
              <THead>
                <TR>
                  <TH>销售单</TH>
                  <TH className="text-right">数量</TH>
                  <TH className="text-right">单价</TH>
                  <TH>状态</TH>
                </TR>
              </THead>
              <TBody>
                {product.salesItems.length === 0 && <TEmpty colSpan={4}>暂无销售记录</TEmpty>}
                {product.salesItems.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <Link href={`/erp/sales/${i.order.id}`} className="font-medium hover:underline">
                        {i.order.no}
                      </Link>
                      <div className="truncate text-xs text-ink-3">
                        {i.order.customer.name} · {formatDate(i.order.orderDate)}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums">{formatNumber(i.quantity)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(i.price)}</TD>
                    <TD>
                      <StatusBadge map={SALES_STATUS} value={i.order.status} />
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
