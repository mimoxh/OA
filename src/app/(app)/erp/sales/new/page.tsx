import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { toDateInput } from "@/lib/format";
import { str } from "@/lib/erp/params";
import { salesFormOptions } from "@/lib/erp/options";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { SalesForm } from "@/components/erp/sales-form";

export default async function NewSalesPage({ searchParams }: PageProps<"/erp/sales/new">) {
  await requirePermission("erp:edit");
  const sp = await searchParams;
  const opts = await salesFormOptions();
  let customerId = str(sp.customerId);
  let opportunityId = str(sp.opportunityId);
  if (opportunityId) {
    const opp = await db.opportunity.findUnique({ where: { id: opportunityId } });
    if (opp) customerId = opp.customerId;
    else opportunityId = "";
  }
  const customer = opts.customers.find((c) => c.id === customerId);
  if (!customer) customerId = "";
  if (!customer?.opportunities.some((o) => o.id === opportunityId)) opportunityId = "";

  return (
    <>
      <TopBar crumbs={[{ label: "ERP 企业资源", href: "/erp" }, { label: "销售订单", href: "/erp/sales" }, { label: "新建" }]} />
      <Page>
        <PageHeader icon="🧾" title="新建销售订单" description="选择客户后自动带出首要联系人与地址；确认订单时将预占所选仓库的库存" />
        <SalesForm
          customers={opts.customers}
          warehouses={opts.warehouses}
          products={opts.products}
          stock={opts.stock}
          initial={{
            customerId,
            opportunityId,
            warehouseId: opts.warehouses[0]?.id ?? "",
            shippingAddress: "",
            consignee: "",
            consigneePhone: "",
            orderDate: toDateInput(new Date()),
            remark: "",
            items: [],
          }}
        />
      </Page>
    </>
  );
}
