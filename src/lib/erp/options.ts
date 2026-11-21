import { db } from "@/lib/db";
import { OPPORTUNITY_STAGE } from "@/lib/labels";
import type { LineProduct } from "@/components/erp/line-items-editor";
import type { SalesCustomerOption } from "@/components/erp/sales-form";

export async function purchaseFormOptions() {
  const [suppliers, warehouses, products] = await Promise.all([
    db.supplier.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    db.warehouse.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { code: "asc" } }),
    db.product.findMany({ orderBy: { sku: "asc" } }),
  ]);
  const lineProducts: LineProduct[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    defaultPrice: p.cost,
    active: p.active,
  }));
  return { suppliers, warehouses, products: lineProducts };
}

export async function salesFormOptions() {
  const [customers, warehouses, products, inventories] = await Promise.all([
    db.customer.findMany({
      where: { status: { not: "LOST" } },
      include: {
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 },
        opportunities: { where: { stage: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" } },
      },
      orderBy: { code: "asc" },
    }),
    db.warehouse.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { code: "asc" } }),
    db.product.findMany({ orderBy: { sku: "asc" } }),
    db.inventory.findMany({ select: { productId: true, warehouseId: true, quantity: true, reservedQty: true } }),
  ]);
  const customerOptions: SalesCustomerOption[] = customers.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    address: c.address,
    phone: c.phone,
    contact: c.contacts[0] ? { name: c.contacts[0].name, phone: c.contacts[0].phone } : null,
    opportunities: c.opportunities.map((o) => ({ id: o.id, name: o.name, stageLabel: OPPORTUNITY_STAGE[o.stage].label })),
  }));
  const stock: Record<string, Record<string, number>> = {};
  for (const i of inventories) {
    (stock[i.warehouseId] ??= {})[i.productId] = i.quantity - i.reservedQty;
  }
  const lineProducts: LineProduct[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    defaultPrice: p.price,
    active: p.active,
  }));
  return { customers: customerOptions, warehouses, products: lineProducts, stock };
}
