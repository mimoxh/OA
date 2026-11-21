import Link from "next/link";
import { History } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatMoney, formatNumber } from "@/lib/format";
import { str } from "@/lib/wms/params";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/common";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { AdjustButton, TransferButton } from "@/components/wms/inventory-actions";
import { ClearFilters, UrlSelect, UrlToggle } from "@/components/wms/url-filters";
import { cn } from "@/lib/utils";

export default async function InventoryPage({ searchParams }: PageProps<"/wms/inventory">) {
  const user = await requireUser();
  const canEdit = can(user, "wms:edit");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const warehouseId = str(sp.warehouse);
  const lowOnly = str(sp.low) === "1";

  const where: Prisma.InventoryWhereInput = {
    ...(warehouseId ? { warehouseId } : {}),
    ...(q ? { product: { OR: [{ sku: { contains: q } }, { name: { contains: q } }, { category: { contains: q } }] } } : {}),
  };
  const [rows, warehouses] = await Promise.all([
    db.inventory.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true, safetyStock: true, cost: true, category: true } },
        warehouse: { select: { id: true, name: true } },
        location: { select: { code: true } },
      },
      orderBy: [{ product: { sku: "asc" } }, { warehouse: { code: "asc" } }],
    }),
    db.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, name: true } }),
  ]);
  const list = lowOnly ? rows.filter((r) => r.quantity < r.product.safetyStock) : rows;
  const lowTotal = rows.filter((r) => r.quantity < r.product.safetyStock).length;
  const sumQty = list.reduce((s, r) => s + r.quantity, 0);
  const sumValue = list.reduce((s, r) => s + r.quantity * r.product.cost, 0);

  return (
    <>
      <TopBar crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "库存" }]} />
      <Page wide>
        <PageHeader
          icon="📦"
          title="库存"
          description="按产品 × 仓库查看实时库存，可用 = 库存 − 已预占"
          meta={
            <>
              <span className="text-ink-2">
                记录 <span className="font-medium tabular-nums text-ink">{list.length}</span>
              </span>
              <span className="text-ink-2">
                库存合计 <span className="font-medium tabular-nums text-ink">{formatNumber(sumQty)}</span>
              </span>
              <span className="text-ink-2">
                库存金额 <span className="font-medium tabular-nums text-ink">{formatMoney(sumValue)}</span>
              </span>
              <span className="text-ink-2">
                低于安全库存 <span className={cn("font-medium tabular-nums", lowTotal ? "text-danger" : "text-ink")}>{lowTotal}</span>
              </span>
            </>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput placeholder="搜索 SKU / 产品名称 / 分类" className="w-64" />
          <UrlSelect param="warehouse" placeholder="全部仓库" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <UrlToggle param="low" label="只看低库存" />
          <ClearFilters keys={["q", "warehouse", "low"]} />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>SKU</TH>
              <TH>产品</TH>
              <TH>仓库</TH>
              <TH>默认库位</TH>
              <TH className="text-right">库存</TH>
              <TH className="text-right">预占</TH>
              <TH className="text-right">可用</TH>
              <TH className="text-right">安全库存</TH>
              <TH>状态</TH>
              <TH className="text-right">操作</TH>
            </TR>
          </THead>
          <TBody>
            {list.length === 0 && <TEmpty colSpan={10}>{q || warehouseId || lowOnly ? "没有符合条件的库存" : "暂无库存记录"}</TEmpty>}
            {list.map((r) => {
              const low = r.quantity < r.product.safetyStock;
              const available = r.quantity - r.reservedQty;
              return (
                <TR key={r.id} className={cn(low && "bg-tag-red/25")}>
                  <TD className="font-mono text-xs text-ink-2">{r.product.sku}</TD>
                  <TD>
                    <div className="font-medium">{r.product.name}</div>
                    {r.product.category && <div className="text-xs text-ink-3">{r.product.category}</div>}
                  </TD>
                  <TD className="whitespace-nowrap">
                    <Link href={`/wms/warehouses/${r.warehouse.id}`} className="hover:underline">
                      {r.warehouse.name}
                    </Link>
                  </TD>
                  <TD className="font-mono text-xs">{r.location?.code ?? <span className="text-ink-3">—</span>}</TD>
                  <TD className={cn("text-right font-medium tabular-nums", low && "text-danger")}>
                    {formatNumber(r.quantity)} <span className="text-xs font-normal text-ink-3">{r.product.unit}</span>
                  </TD>
                  <TD className="text-right tabular-nums text-ink-2">{r.reservedQty ? formatNumber(r.reservedQty) : "—"}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(available)}</TD>
                  <TD className="text-right tabular-nums text-ink-2">{formatNumber(r.product.safetyStock)}</TD>
                  <TD>{low ? <Badge color="red">低于安全库存</Badge> : <Badge color="green">正常</Badge>}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-0.5">
                      {canEdit && (
                        <>
                          <TransferButton
                            row={{
                              productId: r.product.id,
                              productName: r.product.name,
                              sku: r.product.sku,
                              unit: r.product.unit,
                              warehouseId: r.warehouse.id,
                              warehouseName: r.warehouse.name,
                              quantity: r.quantity,
                              reservedQty: r.reservedQty,
                            }}
                            warehouses={warehouses}
                          />
                          <AdjustButton
                            row={{
                              productId: r.product.id,
                              productName: r.product.name,
                              sku: r.product.sku,
                              unit: r.product.unit,
                              warehouseId: r.warehouse.id,
                              warehouseName: r.warehouse.name,
                              quantity: r.quantity,
                              reservedQty: r.reservedQty,
                            }}
                          />
                        </>
                      )}
                      <Link
                        href={`/wms/movements?product=${r.product.id}&warehouse=${r.warehouse.id}`}
                        className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
                      >
                        <History className="size-3.5" />
                        流水
                      </Link>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Page>
    </>
  );
}
