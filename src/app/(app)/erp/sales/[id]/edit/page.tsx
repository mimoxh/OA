import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { toDateInput } from "@/lib/format";
import { salesFormOptions } from "@/lib/erp/options";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { SalesForm } from "@/components/erp/sales-form";

export default async function EditSalesPage({ params }: PageProps<"/erp/sales/[id]/edit">) {
  await requirePermission("erp:edit");
  const { id } = await params;
  const so = await db.salesOrder.findUnique({
    where: { id },
    include: { items: { orderBy: { id: "asc" } }, customer: { include: { contacts: { where: { isPrimary: true }, take: 1 } } }, opportunity: true },
  });
  if (!so) notFound();
  if (so.status !== "DRAFT") redirect(`/erp/sales/${id}`);
  const opts = await salesFormOptions();
  if (!opts.customers.some((c) => c.id === so.customerId)) {
    opts.customers.unshift({
      id: so.customer.id,
      code: so.customer.code,
      name: so.customer.name,
      address: so.customer.address,
      phone: so.customer.phone,
      contact: so.customer.contacts[0] ? { name: so.customer.contacts[0].name, phone: so.customer.contacts[0].phone } : null,
      opportunities: [],
    });
  }
  if (so.opportunity) {
    const c = opts.customers.find((x) => x.id === so.customerId)!;
    if (!c.opportunities.some((o) => o.id === so.opportunity!.id)) {
      c.opportunities = [{ id: so.opportunity.id, name: so.opportunity.name, stageLabel: "已关联" }, ...c.opportunities];
    }
  }
  return (
    <>
      <TopBar
        crumbs={[
          { label: "ERP 企业资源", href: "/erp" },
          { label: "销售订单", href: "/erp/sales" },
          { label: so.no, href: `/erp/sales/${so.id}` },
          { label: "编辑" },
        ]}
      />
      <Page>
        <PageHeader icon="🧾" title={`编辑销售订单 ${so.no}`} description="草稿状态可随时修改，确认后不可再编辑" />
        <SalesForm
          customers={opts.customers}
          warehouses={opts.warehouses}
          products={opts.products}
          stock={opts.stock}
          initial={{
            id: so.id,
            customerId: so.customerId,
            opportunityId: so.opportunityId ?? "",
            warehouseId: so.warehouseId,
            shippingAddress: so.shippingAddress ?? "",
            consignee: so.consignee ?? "",
            consigneePhone: so.consigneePhone ?? "",
            orderDate: toDateInput(so.orderDate),
            remark: so.remark ?? "",
            items: so.items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
          }}
        />
      </Page>
    </>
  );
}
