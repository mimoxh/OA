import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { toDateInput } from "@/lib/format";
import { purchaseFormOptions } from "@/lib/erp/options";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { PurchaseForm } from "@/components/erp/purchase-form";

export default async function EditPurchasePage({ params }: PageProps<"/erp/purchase/[id]/edit">) {
  await requirePermission("erp:edit");
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" } } } });
  if (!po) notFound();
  if (po.status !== "DRAFT" && po.status !== "REJECTED") redirect(`/erp/purchase/${id}`);
  const opts = await purchaseFormOptions();
  return (
    <>
      <TopBar
        crumbs={[
          { label: "ERP 企业资源", href: "/erp" },
          { label: "采购订单", href: "/erp/purchase" },
          { label: po.no, href: `/erp/purchase/${po.id}` },
          { label: "编辑" },
        ]}
      />
      <Page>
        <PageHeader
          icon="🛒"
          title={`编辑采购单 ${po.no}`}
          description={po.status === "REJECTED" ? "该采购单已被驳回，修改后可重新提交审批" : "草稿可随时修改"}
        />
        <PurchaseForm
          rejected={po.status === "REJECTED"}
          suppliers={opts.suppliers}
          warehouses={opts.warehouses}
          products={opts.products}
          initial={{
            id: po.id,
            supplierId: po.supplierId,
            warehouseId: po.warehouseId,
            expectedDate: toDateInput(po.expectedDate),
            remark: po.remark ?? "",
            items: po.items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
          }}
        />
      </Page>
    </>
  );
}
