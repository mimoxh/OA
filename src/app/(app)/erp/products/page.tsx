import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatMoney, formatNumber } from "@/lib/format";
import { str } from "@/lib/erp/params";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { ProductDialog } from "@/components/erp/product-dialog";
import { ActionButton } from "@/components/erp/action-button";
import { setProductActive } from "@/app/(app)/erp/actions";

export default async function ProductsPage({ searchParams }: PageProps<"/erp/products">) {
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const sp = await searchParams;
  const q = str(sp.q);
  const category = str(sp.category);
  const status = str(sp.status);

  const where: Prisma.ProductWhereInput = {
    ...(q ? { OR: [{ sku: { contains: q } }, { name: { contains: q } }, { spec: { contains: q } }] } : {}),
    ...(category ? { category } : {}),
    ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
  };
  const [products, cats, stock, total] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ active: "desc" }, { sku: "asc" }] }),
    db.product.groupBy({ by: ["category"], _count: { _all: true }, orderBy: { category: "asc" } }),
    db.inventory.groupBy({ by: ["productId"], _sum: { quantity: true, reservedQty: true } }),
    db.product.count(),
  ]);
  const stockMap = new Map(stock.map((s) => [s.productId, s._sum]));
  const categories = cats.map((c) => c.category).filter((c): c is string => !!c);

  return (
    <>
      <TopBar
        crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "产品" }]}
        actions={
          canEdit && (
            <ProductDialog
              categories={categories}
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建产品
                </Button>
              }
            />
          )
        }
      />
      <Page wide>
        <PageHeader icon="📦" title="产品" description={`共 ${total} 个产品，库存按全部仓库汇总`} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FilterPills
            param="category"
            options={cats.filter((c) => c.category).map((c) => ({ value: c.category!, label: c.category!, count: c._count._all }))}
          />
          <div className="flex items-center gap-2">
            <FilterPills
              param="status"
              options={[
                { value: "active", label: "在售" },
                { value: "inactive", label: "已停用" },
              ]}
            />
            <SearchInput placeholder="搜索 SKU、名称、规格…" />
          </div>
        </div>
        {total === 0 ? (
          <EmptyState icon="📦" title="还没有产品" description="新建产品后即可用于采购、销售与库存管理" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>SKU</TH>
                <TH>名称</TH>
                <TH>分类</TH>
                <TH>单位</TH>
                <TH className="text-right">售价</TH>
                <TH className="text-right">成本</TH>
                <TH className="text-right">总库存 / 可用</TH>
                <TH className="text-right">安全库存</TH>
                <TH>状态</TH>
                {canEdit && <TH className="text-right">操作</TH>}
              </TR>
            </THead>
            <TBody>
              {products.length === 0 && <TEmpty colSpan={canEdit ? 10 : 9}>没有符合条件的产品</TEmpty>}
              {products.map((p) => {
                const s = stockMap.get(p.id);
                const qty = s?.quantity ?? 0;
                const avail = qty - (s?.reservedQty ?? 0);
                const low = p.safetyStock > 0 && qty < p.safetyStock;
                return (
                  <TR key={p.id} className={p.active ? undefined : "opacity-60"}>
                    <TD className="font-mono text-xs text-ink-2">{p.sku}</TD>
                    <TD>
                      <Link href={`/erp/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      {p.spec && <div className="text-xs text-ink-3">{p.spec}</div>}
                    </TD>
                    <TD>{p.category ? <Badge>{p.category}</Badge> : <span className="text-ink-3">—</span>}</TD>
                    <TD className="text-ink-2">{p.unit}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(p.price)}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{formatMoney(p.cost)}</TD>
                    <TD className="text-right tabular-nums">
                      <span className={low ? "font-medium text-danger" : undefined}>{formatNumber(qty)}</span>
                      <span className="mx-1 text-ink-3">/</span>
                      <span className="text-ink-2">{formatNumber(avail)}</span>
                    </TD>
                    <TD className="text-right tabular-nums text-ink-2">{formatNumber(p.safetyStock)}</TD>
                    <TD>
                      {!p.active ? <Badge>已停用</Badge> : low ? <Badge color="orange">低于安全库存</Badge> : <Badge color="green">在售</Badge>}
                    </TD>
                    {canEdit && (
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <ProductDialog categories={categories} product={p} trigger={<Button variant="ghost" size="xs">编辑</Button>} />
                          <ActionButton
                            variant="ghost"
                            size="xs"
                            action={setProductActive.bind(null, p.id, !p.active)}
                            success={p.active ? "产品已停用" : "产品已启用"}
                            confirm={
                              p.active
                                ? { title: `停用「${p.name}」？`, description: "停用后新建采购单、销售单时不能再选择该产品，历史单据不受影响。" }
                                : undefined
                            }
                            danger={p.active}
                            confirmText="停用"
                          >
                            {p.active ? "停用" : "启用"}
                          </ActionButton>
                        </div>
                      </TD>
                    )}
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
