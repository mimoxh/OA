import { endOfDay, startOfDay } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { formatNumber, parseDateInput } from "@/lib/format";
import { MOVEMENT_TYPE } from "@/lib/labels";
import { pageNum, str } from "@/lib/wms/params";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { MovementTable, movementInclude } from "@/components/wms/movement-table";
import { Pagination } from "@/components/wms/pagination";
import { ClearFilters, UrlDate, UrlSelect } from "@/components/wms/url-filters";

const PAGE_SIZE = 30;

export default async function MovementsPage({ searchParams }: PageProps<"/wms/movements">) {
  await requireUser();
  const sp = await searchParams;
  const productId = str(sp.product);
  const warehouseId = str(sp.warehouse);
  const type = str(sp.type);
  const from = parseDateInput(str(sp.from));
  const to = parseDateInput(str(sp.to));
  const page = pageNum(sp.page);

  const where: Prisma.StockMovementWhereInput = {
    ...(productId ? { productId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(type && type in MOVEMENT_TYPE ? { type: type as keyof typeof MOVEMENT_TYPE } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: startOfDay(from) } : {}), ...(to ? { lte: endOfDay(to) } : {}) } } : {}),
  };
  const [rows, total, sums, products, warehouses] = await Promise.all([
    db.stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: movementInclude }),
    db.stockMovement.count({ where }),
    db.stockMovement.groupBy({ by: ["type"], where, _sum: { quantity: true } }),
    db.product.findMany({ orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true } }),
    db.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, name: true } }),
  ]);
  const inQty = sums.filter((s) => (s._sum.quantity ?? 0) > 0).reduce((a, s) => a + (s._sum.quantity ?? 0), 0);
  const outQty = sums.filter((s) => (s._sum.quantity ?? 0) < 0).reduce((a, s) => a + (s._sum.quantity ?? 0), 0);

  return (
    <>
      <TopBar crumbs={[{ label: "WMS 仓储", href: "/wms" }, { label: "库存流水" }]} />
      <Page wide>
        <PageHeader
          icon="🧾"
          title="库存流水"
          description="所有入库、出库、调拨、盘点产生的库存变动记录"
          meta={
            <>
              <span className="text-ink-2">
                记录 <span className="font-medium tabular-nums text-ink">{formatNumber(total)}</span>
              </span>
              {sums.map((s) => (
                <span key={s.type} className="text-ink-2">
                  {MOVEMENT_TYPE[s.type].label}{" "}
                  <span className="font-medium tabular-nums text-ink">{formatNumber(s._sum.quantity ?? 0)}</span>
                </span>
              ))}
              <span className="text-ink-2">
                净变动 <span className="font-medium tabular-nums text-ink">{formatNumber(inQty + outQty)}</span>
              </span>
            </>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <UrlSelect param="product" placeholder="全部产品" options={products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} />
          <UrlSelect param="warehouse" placeholder="全部仓库" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <UrlSelect param="type" placeholder="全部类型" options={Object.entries(MOVEMENT_TYPE).map(([value, m]) => ({ value, label: m.label }))} />
          {/* 手机上起止日期占一整行，不被拆到两行 */}
          <div className="flex items-center gap-2 md:contents max-md:w-full">
            <UrlDate param="from" label="从" />
            <UrlDate param="to" label="至" />
          </div>
          <ClearFilters keys={["product", "warehouse", "type", "from", "to"]} />
        </div>
        <MovementTable rows={rows} />
        <Pagination basePath="/wms/movements" searchParams={sp} page={page} pageSize={PAGE_SIZE} total={total} />
      </Page>
    </>
  );
}
