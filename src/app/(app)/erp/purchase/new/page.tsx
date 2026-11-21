import { requirePermission } from "@/lib/auth/dal";
import { str } from "@/lib/erp/params";
import { purchaseFormOptions } from "@/lib/erp/options";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { PurchaseForm } from "@/components/erp/purchase-form";

export default async function NewPurchasePage({ searchParams }: PageProps<"/erp/purchase/new">) {
  await requirePermission("erp:edit");
  const sp = await searchParams;
  const opts = await purchaseFormOptions();
  const supplierId = str(sp.supplierId);
  return (
    <>
      <TopBar crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "采购订单", href: "/erp/purchase" }, { label: "新建" }]} />
      <Page>
        <PageHeader icon="🛒" title="新建采购单" description="保存草稿后可继续编辑；提交审批后进入部门主管 → 财务审核流程" />
        <PurchaseForm
          suppliers={opts.suppliers}
          warehouses={opts.warehouses}
          products={opts.products}
          initial={{
            supplierId: opts.suppliers.some((s) => s.id === supplierId) ? supplierId : "",
            warehouseId: opts.warehouses[0]?.id ?? "",
            expectedDate: "",
            remark: "",
            items: [],
          }}
        />
      </Page>
    </>
  );
}
