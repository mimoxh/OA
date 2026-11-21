import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatMoney, formatNumber } from "@/lib/format";
import { round2, str } from "@/lib/erp/params";
import { Button } from "@/components/ui/button";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { Table, TBody, TD, TEmpty, TH, THead, TR } from "@/components/ui/table";
import { RatingStars } from "@/components/erp/rating-stars";
import { SupplierDialog } from "@/components/erp/supplier-dialog";

export default async function SuppliersPage({ searchParams }: PageProps<"/erp/suppliers">) {
  const user = await requireUser();
  const canEdit = can(user, "erp:edit");
  const sp = await searchParams;
  const q = str(sp.q);
  const rating = Number(str(sp.rating)) || 0;
  const [suppliers, total, payables, poSums] = await Promise.all([
    db.supplier.findMany({
      where: {
        ...(q
          ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { contact: { contains: q } }, { phone: { contains: q } }] }
          : {}),
        ...(rating ? { rating: { gte: rating } } : {}),
      },
      include: { _count: { select: { purchaseOrders: true } } },
      orderBy: { code: "asc" },
    }),
    db.supplier.count(),
    db.invoice.groupBy({
      by: ["supplierId"],
      where: { type: "PAYABLE", status: { in: ["UNPAID", "PARTIAL"] } },
      _sum: { amount: true, paidAmount: true },
    }),
    db.purchaseOrder.groupBy({
      by: ["supplierId"],
      where: { status: { notIn: ["DRAFT", "CANCELLED", "REJECTED"] } },
      _sum: { totalAmount: true },
    }),
  ]);
  const apMap = new Map(payables.map((p) => [p.supplierId, round2((p._sum.amount ?? 0) - (p._sum.paidAmount ?? 0))]));
  const poMap = new Map(poSums.map((p) => [p.supplierId, p._sum.totalAmount ?? 0]));

  return (
    <>
      <TopBar
        crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "供应商" }]}
        actions={
          canEdit && (
            <SupplierDialog
              trigger={
                <Button variant="primary">
                  <Plus className="size-3.5" />
                  新建供应商
                </Button>
              }
            />
          )
        }
      />
      <Page wide>
        <PageHeader icon="🏭" title="供应商" description={`共 ${total} 家供应商`} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FilterPills
            param="rating"
            options={[
              { value: "5", label: "★★★★★" },
              { value: "4", label: "4 星及以上" },
              { value: "3", label: "3 星及以上" },
            ]}
          />
          <SearchInput placeholder="搜索名称、编码、联系人…" />
        </div>
        {total === 0 ? (
          <EmptyState icon="🏭" title="还没有供应商" description="新建供应商后即可创建采购订单" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>编码</TH>
                <TH>名称</TH>
                <TH>联系人</TH>
                <TH>电话</TH>
                <TH>评级</TH>
                <TH className="text-right">采购单</TH>
                <TH className="text-right">累计采购额</TH>
                <TH className="text-right">应付未付</TH>
              </TR>
            </THead>
            <TBody>
              {suppliers.length === 0 && <TEmpty colSpan={8}>没有符合条件的供应商</TEmpty>}
              {suppliers.map((s) => {
                const ap = apMap.get(s.id) ?? 0;
                return (
                  <TR key={s.id}>
                    <TD className="font-mono text-xs text-ink-2">{s.code}</TD>
                    <TD>
                      <Link href={`/erp/suppliers/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                      {s.address && <div className="text-xs text-ink-3">{s.address}</div>}
                    </TD>
                    <TD>{s.contact ?? "—"}</TD>
                    <TD className="text-ink-2">{s.phone ?? "—"}</TD>
                    <TD>
                      <RatingStars value={s.rating} />
                    </TD>
                    <TD className="text-right tabular-nums">{formatNumber(s._count.purchaseOrders)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(poMap.get(s.id) ?? 0)}</TD>
                    <TD className={`text-right tabular-nums ${ap > 0 ? "text-[#d9730d]" : "text-ink-3"}`}>{formatMoney(ap)}</TD>
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
