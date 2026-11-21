"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { runAction } from "@/lib/action";
import { nextCode, nextNo } from "@/lib/sequence";
import { audit } from "@/lib/services/notify";
import { startApproval, withdrawApproval } from "@/lib/services/approval";
import { calcTotal, cancelSalesOrder, confirmSalesOrder, createSalesOrderFromOpportunity } from "@/lib/services/flows";
import { formatDate, formatMoney, parseDateInput } from "@/lib/format";
import { parseInput } from "@/lib/erp/validate";

function refresh() {
  revalidatePath("/erp", "layout");
  revalidatePath("/finance", "layout");
  revalidatePath("/wms", "layout");
  revalidatePath("/oa", "layout");
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `内容不能超过 ${max} 个字`)
    .nullish()
    .transform((v) => v || null);

const money = (label: string) =>
  z.number({ error: `${label}必须是数字` }).min(0, `${label}不能为负数`).max(1e10, `${label}过大`);

// ───────────────────────── 产品 ─────────────────────────

const productSchema = z.object({
  id: z.string().optional(),
  sku: z.string().trim().min(1, "请填写 SKU").max(40, "SKU 不能超过 40 个字符"),
  name: z.string().trim().min(1, "请填写产品名称").max(100, "名称不能超过 100 个字"),
  category: optText(40),
  unit: z.string().trim().min(1, "请填写单位").max(10, "单位不能超过 10 个字"),
  spec: optText(200),
  price: money("售价"),
  cost: money("成本"),
  weight: z.number({ error: "重量必须是数字" }).min(0, "重量不能为负数"),
  safetyStock: z.number({ error: "安全库存必须是数字" }).int("安全库存必须为整数").min(0, "安全库存不能为负数"),
});

export async function saveProduct(input: z.input<typeof productSchema>) {
  return runAction("erp:edit", async (user) => {
    const v = parseInput(productSchema, input);
    const dup = await db.product.findFirst({ where: { sku: v.sku, ...(v.id ? { id: { not: v.id } } : {}) } });
    if (dup) throw new Error(`SKU「${v.sku}」已被产品「${dup.name}」使用`);
    const { id, ...data } = v;
    const product = id
      ? await db.product.update({ where: { id }, data })
      : await db.product.create({ data });
    await audit(db, { entityType: "product", entityId: product.id, action: id ? "updated" : "created", userId: user.id });
    refresh();
    return { id: product.id };
  });
}

export async function setProductActive(id: string, active: boolean) {
  return runAction("erp:edit", async (user) => {
    const p = await db.product.findUnique({ where: { id } });
    if (!p) throw new Error("产品不存在");
    await db.product.update({ where: { id }, data: { active } });
    await audit(db, { entityType: "product", entityId: id, action: active ? "enabled" : "disabled", userId: user.id });
    refresh();
  });
}

// ───────────────────────── 供应商 ─────────────────────────

const supplierSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写供应商名称").max(100, "名称不能超过 100 个字"),
  contact: optText(40),
  phone: optText(40),
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "邮箱格式不正确"),
  address: optText(200),
  rating: z.number().int().min(1, "评级为 1-5 星").max(5, "评级为 1-5 星"),
  remark: optText(500),
});

export async function saveSupplier(input: z.input<typeof supplierSchema>) {
  return runAction("erp:edit", async () => {
    const v = parseInput(supplierSchema, input);
    const { id, ...data } = v;
    const dup = await db.supplier.findFirst({ where: { name: data.name, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new Error(`供应商「${data.name}」已存在（${dup.code}）`);
    const supplier = await db.$transaction(async (tx) =>
      id
        ? tx.supplier.update({ where: { id }, data })
        : tx.supplier.create({ data: { ...data, code: await nextCode(tx, "SUP") } }),
    );
    refresh();
    return { id: supplier.id };
  });
}

export async function deleteSupplier(id: string) {
  return runAction("erp:edit", async () => {
    const s = await db.supplier.findUnique({
      where: { id },
      include: { _count: { select: { purchaseOrders: true, invoices: true } } },
    });
    if (!s) throw new Error("供应商不存在");
    if (s._count.purchaseOrders || s._count.invoices) {
      throw new Error(`供应商已有 ${s._count.purchaseOrders} 张采购单、${s._count.invoices} 张发票，不能删除`);
    }
    await db.supplier.delete({ where: { id } });
    refresh();
  });
}

// ───────────────────────── 明细行 ─────────────────────────

const lineSchema = z.object({
  productId: z.string().min(1, "请为每一行选择产品"),
  quantity: z.number({ error: "数量必须是数字" }).int("数量必须为整数").positive("数量必须大于 0").max(1e7, "数量过大"),
  price: money("单价"),
});

const linesSchema = z
  .array(lineSchema)
  .min(1, "请至少添加一行明细")
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, "明细中有重复的产品，请合并为一行");

async function assertProducts(tx: Tx, ids: string[]) {
  const found = await tx.product.count({ where: { id: { in: ids } } });
  if (found !== new Set(ids).size) throw new Error("明细中有不存在的产品");
}

// ───────────────────────── 采购订单 ─────────────────────────

const purchaseSchema = z.object({
  id: z.string().optional(),
  supplierId: z.string().min(1, "请选择供应商"),
  warehouseId: z.string().min(1, "请选择入库仓库"),
  expectedDate: z.string().nullish(),
  remark: optText(500),
  items: linesSchema,
  submit: z.boolean().optional(),
});

async function submitPurchase(tx: Tx, id: string, userId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { product: true } }, supplier: true, warehouse: true },
  });
  if (!po) throw new Error("采购单不存在");
  if (po.status !== "DRAFT" && po.status !== "REJECTED") throw new Error("只有草稿或已驳回的采购单可以提交审批");
  if (!po.items.length) throw new Error("采购单没有明细");
  const resubmit = po.status === "REJECTED" || !!po.approvalInstanceId;
  // 先置为审批中：若流程没有审批节点，startApproval 会立即触发通过回调把状态改为 APPROVED
  await tx.purchaseOrder.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  const instance = await startApproval(tx, {
    flowKey: "purchase_order",
    title: `采购订单 ${po.no}（${po.supplier.name}）`,
    applicantId: userId,
    bizType: "purchase_order",
    bizId: po.id,
    formData: {
      采购单号: po.no,
      供应商: po.supplier.name,
      入库仓库: po.warehouse.name,
      金额: formatMoney(po.totalAmount),
      预计到货: formatDate(po.expectedDate),
      明细: po.items.map((i) => `${i.product.name} × ${i.quantity}${i.product.unit} @ ${formatMoney(i.price)}`).join("；"),
      备注: po.remark ?? "",
    },
  });
  await tx.purchaseOrder.update({ where: { id }, data: { approvalInstanceId: instance.id } });
  await audit(tx, { entityType: "purchase_order", entityId: id, action: resubmit ? "resubmitted" : "submitted", userId });
}

export async function savePurchaseOrder(input: z.input<typeof purchaseSchema>) {
  return runAction("erp:edit", async (user) => {
    const v = parseInput(purchaseSchema, input);
    const id = await db.$transaction(async (tx) => {
      await assertProducts(tx, v.items.map((i) => i.productId));
      const data = {
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        expectedDate: parseDateInput(v.expectedDate),
        remark: v.remark,
        totalAmount: calcTotal(v.items),
      };
      let poId: string;
      if (v.id) {
        const cur = await tx.purchaseOrder.findUnique({ where: { id: v.id } });
        if (!cur) throw new Error("采购单不存在");
        if (cur.status !== "DRAFT" && cur.status !== "REJECTED") throw new Error("只有草稿或已驳回的采购单可以编辑");
        await tx.purchaseOrderItem.deleteMany({ where: { orderId: cur.id } });
        await tx.purchaseOrder.update({ where: { id: cur.id }, data: { ...data, status: "DRAFT", items: { create: v.items } } });
        await audit(tx, { entityType: "purchase_order", entityId: cur.id, action: "updated", userId: user.id });
        poId = cur.id;
      } else {
        const po = await tx.purchaseOrder.create({
          data: { ...data, no: await nextNo(tx, "PO"), createdById: user.id, items: { create: v.items } },
        });
        await audit(tx, { entityType: "purchase_order", entityId: po.id, action: "created", userId: user.id });
        poId = po.id;
      }
      if (v.submit) await submitPurchase(tx, poId, user.id);
      return poId;
    });
    refresh();
    return { id };
  });
}

export async function submitPurchaseOrder(id: string) {
  return runAction("erp:edit", async (user) => {
    await db.$transaction((tx) => submitPurchase(tx, id, user.id));
    refresh();
  });
}

export async function withdrawPurchaseOrder(id: string) {
  return runAction("erp:edit", async (user) => {
    await db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!po) throw new Error("采购单不存在");
      if (po.status !== "PENDING_APPROVAL" || !po.approvalInstanceId) throw new Error("只有审批中的采购单可以撤回");
      await withdrawApproval(tx, { instanceId: po.approvalInstanceId, userId: user.id });
      await audit(tx, { entityType: "purchase_order", entityId: id, action: "withdrawn", userId: user.id });
    });
    refresh();
  });
}

export async function cancelPurchaseOrder(id: string) {
  return runAction("erp:edit", async (user) => {
    await db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { inboundOrders: true } });
      if (!po) throw new Error("采购单不存在");
      if (!["DRAFT", "REJECTED", "APPROVED"].includes(po.status)) {
        throw new Error("只有草稿、已驳回或待入库（未收货）的采购单可以取消");
      }
      if (po.inboundOrders.some((i) => i.status === "COMPLETED")) throw new Error("已有入库记录的采购单不能取消");
      await tx.inboundOrder.updateMany({ where: { purchaseOrderId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
      await audit(tx, { entityType: "purchase_order", entityId: id, action: "cancelled", userId: user.id });
    });
    refresh();
  });
}

export async function deletePurchaseOrder(id: string) {
  return runAction("erp:edit", async () => {
    const po = await db.purchaseOrder.findUnique({ where: { id }, include: { _count: { select: { inboundOrders: true, invoices: true } } } });
    if (!po) throw new Error("采购单不存在");
    if (po.status !== "DRAFT" && po.status !== "CANCELLED") throw new Error("只有草稿或已取消的采购单可以删除");
    if (po._count.inboundOrders || po._count.invoices) throw new Error("采购单已有关联的入库单或发票，不能删除");
    await db.purchaseOrder.delete({ where: { id } });
    refresh();
  });
}

// ───────────────────────── 销售订单 ─────────────────────────

const salesSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1, "请选择客户"),
  opportunityId: z
    .string()
    .nullish()
    .transform((v) => v || null),
  warehouseId: z.string().min(1, "请选择发货仓库"),
  shippingAddress: optText(200),
  consignee: optText(40),
  consigneePhone: optText(40),
  orderDate: z.string().nullish(),
  remark: optText(500),
  items: linesSchema,
  confirm: z.boolean().optional(),
});

export async function saveSalesOrder(input: z.input<typeof salesSchema>) {
  return runAction("erp:edit", async (user) => {
    const v = parseInput(salesSchema, input);
    if (v.confirm && !v.shippingAddress) throw new Error("确认订单前请填写收货地址");
    const id = await db.$transaction(async (tx) => {
      await assertProducts(tx, v.items.map((i) => i.productId));
      const orderDate = parseDateInput(v.orderDate) ?? undefined;
      const header = {
        warehouseId: v.warehouseId,
        shippingAddress: v.shippingAddress,
        consignee: v.consignee,
        consigneePhone: v.consigneePhone,
        remark: v.remark,
        totalAmount: calcTotal(v.items),
        ...(orderDate ? { orderDate } : {}),
      };
      let soId: string;
      if (v.id) {
        const cur = await tx.salesOrder.findUnique({ where: { id: v.id } });
        if (!cur) throw new Error("销售订单不存在");
        if (cur.status !== "DRAFT") throw new Error("只有草稿状态的订单可以编辑");
        await tx.salesOrderItem.deleteMany({ where: { orderId: cur.id } });
        await tx.salesOrder.update({
          where: { id: cur.id },
          data: { ...header, customerId: v.customerId, items: { create: v.items } },
        });
        await audit(tx, { entityType: "sales_order", entityId: cur.id, action: "updated", userId: user.id });
        soId = cur.id;
      } else if (v.opportunityId) {
        const opp = await tx.opportunity.findUnique({ where: { id: v.opportunityId } });
        if (!opp) throw new Error("商机不存在");
        if (opp.customerId !== v.customerId) throw new Error("所选商机不属于该客户");
        const so = await createSalesOrderFromOpportunity(tx, {
          opportunityId: opp.id,
          warehouseId: v.warehouseId,
          userId: user.id,
          items: v.items,
          shippingAddress: v.shippingAddress ?? undefined,
          consignee: v.consignee ?? undefined,
          consigneePhone: v.consigneePhone ?? undefined,
          remark: v.remark ?? undefined,
        });
        if (orderDate) await tx.salesOrder.update({ where: { id: so.id }, data: { orderDate } });
        soId = so.id;
      } else {
        const so = await tx.salesOrder.create({
          data: { ...header, no: await nextNo(tx, "SO"), customerId: v.customerId, createdById: user.id, items: { create: v.items } },
        });
        await audit(tx, { entityType: "sales_order", entityId: so.id, action: "created", userId: user.id });
        soId = so.id;
      }
      if (v.confirm) await confirmSalesOrder(tx, { salesOrderId: soId, userId: user.id });
      return soId;
    });
    refresh();
    revalidatePath("/crm", "layout");
    return { id };
  });
}

export async function confirmSales(id: string) {
  return runAction("erp:edit", async (user) => {
    await db.$transaction(async (tx) => {
      const so = await tx.salesOrder.findUnique({ where: { id } });
      if (!so) throw new Error("销售订单不存在");
      if (!so.shippingAddress) throw new Error("请先编辑订单填写收货地址");
      await confirmSalesOrder(tx, { salesOrderId: id, userId: user.id });
    });
    refresh();
  });
}

export async function cancelSales(id: string) {
  return runAction("erp:edit", async (user) => {
    await db.$transaction((tx) => cancelSalesOrder(tx, { salesOrderId: id, userId: user.id }));
    refresh();
  });
}

export async function deleteSalesOrder(id: string) {
  return runAction("erp:edit", async () => {
    const so = await db.salesOrder.findUnique({
      where: { id },
      include: { _count: { select: { outboundOrders: true, invoices: true, transportOrders: true } } },
    });
    if (!so) throw new Error("销售订单不存在");
    if (so.status !== "DRAFT" && so.status !== "CANCELLED") throw new Error("只有草稿或已取消的订单可以删除");
    if (so._count.invoices || so._count.transportOrders) throw new Error("订单已有关联的发票或运输单，不能删除");
    await db.$transaction(async (tx) => {
      await tx.outboundOrder.deleteMany({ where: { salesOrderId: id, status: "CANCELLED" } });
      await tx.salesOrder.delete({ where: { id } });
    });
    refresh();
  });
}
