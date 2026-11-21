"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { nextNo } from "@/lib/sequence";
import { parseDateInput } from "@/lib/format";
import { adjustStock, transferStock } from "@/lib/services/inventory";
import { receiveInbound, shipOutbound, startPicking } from "@/lib/services/flows";
import { audit } from "@/lib/services/notify";
import { parse } from "@/lib/wms/parse";

function refresh() {
  revalidatePath("/", "layout");
}

const id = z.string().min(1, "参数缺失");
const qty = (msg: string) => z.coerce.number({ error: msg }).int(`${msg}必须为整数`).positive(`${msg}必须大于 0`);
const optText = (max = 500) => z.string().trim().max(max, `内容不能超过 ${max} 字`).optional().nullable();

// ───────────── 库存：调拨 / 盘点 ─────────────

const transferSchema = z.object({
  productId: id,
  fromWarehouseId: z.string().min(1, "请选择调出仓库"),
  toWarehouseId: z.string().min(1, "请选择调入仓库"),
  quantity: qty("调拨数量"),
  memo: optText(200),
});

export async function transferInventory(input: {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number | string;
  memo?: string;
}) {
  return runAction("wms:edit", async (user) => {
    const d = parse(transferSchema, input);
    await db.$transaction((tx) =>
      transferStock(tx, {
        productId: d.productId,
        fromWarehouseId: d.fromWarehouseId,
        toWarehouseId: d.toWarehouseId,
        quantity: d.quantity,
        userId: user.id,
        memo: d.memo || undefined,
      }),
    );
    refresh();
  });
}

const adjustSchema = z.object({
  productId: id,
  warehouseId: id,
  newQuantity: z.coerce.number({ error: "请填写实盘数量" }).int("实盘数量必须为整数").min(0, "实盘数量不能为负数"),
  memo: z.string().trim().min(1, "请填写盘点原因").max(200, "原因不能超过 200 字"),
});

export async function adjustInventory(input: { productId: string; warehouseId: string; newQuantity: number | string; memo: string }) {
  return runAction("wms:edit", async (user) => {
    const d = parse(adjustSchema, input);
    const balance = await db.$transaction((tx) =>
      adjustStock(tx, { productId: d.productId, warehouseId: d.warehouseId, newQuantity: d.newQuantity, userId: user.id, memo: `盘点：${d.memo}` }),
    );
    refresh();
    return balance;
  });
}

// ───────────── 入库 ─────────────

const linesSchema = z
  .array(z.object({ productId: z.string().min(1, "请选择产品"), quantity: qty("数量") }))
  .min(1, "请至少添加一个产品")
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, "同一产品请合并为一行");

const createInboundSchema = z.object({
  type: z.enum(["RETURN", "OTHER"], { error: "请选择入库类型" }),
  warehouseId: z.string().min(1, "请选择仓库"),
  expectedDate: z.string().optional().nullable(),
  remark: optText(),
  items: linesSchema,
});

export async function createInbound(input: {
  type: string;
  warehouseId: string;
  expectedDate?: string;
  remark?: string;
  items: { productId: string; quantity: number | string }[];
}) {
  return runAction("wms:edit", async (user) => {
    const d = parse(createInboundSchema, input);
    const order = await db.$transaction(async (tx) => {
      const inbound = await tx.inboundOrder.create({
        data: {
          no: await nextNo(tx, "IN"),
          type: d.type,
          warehouseId: d.warehouseId,
          expectedDate: parseDateInput(d.expectedDate),
          remark: d.remark || null,
          createdById: user.id,
          items: { create: d.items.map((i) => ({ productId: i.productId, expectedQty: i.quantity })) },
        },
      });
      await audit(tx, { entityType: "inbound", entityId: inbound.id, action: "created", userId: user.id });
      return inbound;
    });
    refresh();
    return { id: order.id };
  });
}

const receiveSchema = z.object({
  inboundId: id,
  items: z.array(
    z.object({
      id,
      receivedQty: z.coerce.number({ error: "请填写实收数量" }).int("实收数量必须为整数").min(0, "实收数量不能为负数"),
      locationId: z.string().optional().nullable(),
    }),
  ),
});

export async function confirmReceive(input: {
  inboundId: string;
  items: { id: string; receivedQty: number | string; locationId?: string | null }[];
}) {
  return runAction("wms:edit", async (user) => {
    const d = parse(receiveSchema, input);
    const inbound = await db.inboundOrder.findUnique({ where: { id: d.inboundId }, select: { warehouseId: true } });
    if (!inbound) throw new Error("入库单不存在");
    const locationIds = [...new Set(d.items.map((i) => i.locationId).filter((x): x is string => !!x))];
    if (locationIds.length) {
      const valid = await db.location.count({ where: { id: { in: locationIds }, warehouseId: inbound.warehouseId } });
      if (valid !== locationIds.length) throw new Error("上架库位不属于该仓库");
    }
    await db.$transaction((tx) =>
      receiveInbound(tx, {
        inboundId: d.inboundId,
        userId: user.id,
        items: d.items.map((i) => ({ id: i.id, receivedQty: i.receivedQty, locationId: i.locationId || null })),
      }),
    );
    refresh();
  });
}

export async function cancelInbound(inboundId: string) {
  return runAction("wms:edit", async (user) => {
    await db.$transaction(async (tx) => {
      const inbound = await tx.inboundOrder.findUnique({ where: { id: inboundId } });
      if (!inbound) throw new Error("入库单不存在");
      if (inbound.status !== "PENDING") throw new Error("只有待收货的入库单可以取消");
      await tx.inboundOrder.update({ where: { id: inbound.id }, data: { status: "CANCELLED" } });
      await audit(tx, { entityType: "inbound", entityId: inbound.id, action: "cancelled", userId: user.id });
    });
    refresh();
  });
}

// ───────────── 出库 ─────────────

const createOutboundSchema = z.object({
  warehouseId: z.string().min(1, "请选择仓库"),
  remark: optText(),
  items: linesSchema,
});

export async function createOutbound(input: {
  warehouseId: string;
  remark?: string;
  items: { productId: string; quantity: number | string }[];
}) {
  return runAction("wms:edit", async (user) => {
    const d = parse(createOutboundSchema, input);
    const order = await db.$transaction(async (tx) => {
      for (const item of d.items) {
        const inv = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: d.warehouseId } },
          include: { product: true },
        });
        const available = inv ? inv.quantity - inv.reservedQty : 0;
        if (available < item.quantity) {
          const name = inv?.product.name ?? (await tx.product.findUnique({ where: { id: item.productId } }))?.name ?? "产品";
          throw new Error(`可用库存不足：「${name}」可用 ${available}，需要 ${item.quantity}`);
        }
      }
      const outbound = await tx.outboundOrder.create({
        data: {
          no: await nextNo(tx, "OUT"),
          type: "OTHER",
          warehouseId: d.warehouseId,
          remark: d.remark || null,
          createdById: user.id,
          items: { create: d.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
        },
      });
      await audit(tx, { entityType: "outbound", entityId: outbound.id, action: "created", userId: user.id });
      return outbound;
    });
    refresh();
    return { id: order.id };
  });
}

export async function startPick(outboundId: string) {
  return runAction("wms:edit", async (user) => {
    await db.$transaction((tx) => startPicking(tx, { outboundId, userId: user.id }));
    refresh();
  });
}

export async function confirmShip(outboundId: string) {
  return runAction("wms:edit", async (user) => {
    const transport = await db.$transaction(async (tx) => {
      const ob = await tx.outboundOrder.findUnique({ where: { id: outboundId }, include: { items: { include: { product: true } } } });
      if (!ob) throw new Error("出库单不存在");
      // 手工出库不预占库存，发货时需要避免占用销售订单已预占的数量
      if (ob.type === "OTHER") {
        for (const item of ob.items) {
          const inv = await tx.inventory.findUnique({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: ob.warehouseId } },
          });
          const available = inv ? inv.quantity - inv.reservedQty : 0;
          if (available < item.quantity) throw new Error(`可用库存不足：「${item.product.name}」可用 ${available}，需要 ${item.quantity}`);
        }
      }
      return shipOutbound(tx, { outboundId, userId: user.id });
    });
    refresh();
    return { transportId: transport?.id ?? null, transportNo: transport?.no ?? null };
  });
}

export async function cancelOutbound(outboundId: string) {
  return runAction("wms:edit", async (user) => {
    await db.$transaction(async (tx) => {
      const ob = await tx.outboundOrder.findUnique({ where: { id: outboundId } });
      if (!ob) throw new Error("出库单不存在");
      if (ob.type === "SALES") throw new Error("销售出库单请在销售订单中取消");
      if (ob.status !== "PENDING" && ob.status !== "PICKING") throw new Error("只有待拣货或拣货中的出库单可以取消");
      await tx.outboundOrder.update({ where: { id: ob.id }, data: { status: "CANCELLED" } });
      await audit(tx, { entityType: "outbound", entityId: ob.id, action: "cancelled", userId: user.id });
    });
    refresh();
  });
}

// ───────────── 仓库与库位 ─────────────

const warehouseSchema = z.object({
  id: z.string().optional().nullable(),
  code: z
    .string()
    .trim()
    .min(1, "请填写仓库编码")
    .max(20, "编码不能超过 20 个字符")
    .regex(/^[A-Za-z0-9_-]+$/, "编码只能包含字母、数字、下划线和短横线"),
  name: z.string().trim().min(1, "请填写仓库名称").max(50, "名称不能超过 50 字"),
  address: optText(200),
  managerId: z.string().optional().nullable(),
  active: z.boolean().default(true),
});

export async function saveWarehouse(input: {
  id?: string | null;
  code: string;
  name: string;
  address?: string;
  managerId?: string | null;
  active?: boolean;
}) {
  return runAction("wms:edit", async (user) => {
    const d = parse(warehouseSchema, input);
    const code = d.code.toUpperCase();
    const dup = await db.warehouse.findFirst({ where: { code, ...(d.id ? { NOT: { id: d.id } } : {}) } });
    if (dup) throw new Error(`仓库编码 ${code} 已存在`);
    const data = { code, name: d.name, address: d.address || null, managerId: d.managerId || null, active: d.active };
    const wh = d.id ? await db.warehouse.update({ where: { id: d.id }, data }) : await db.warehouse.create({ data });
    await audit(db, { entityType: "warehouse", entityId: wh.id, action: d.id ? "updated" : "created", userId: user.id });
    refresh();
    return { id: wh.id };
  });
}

export async function deleteWarehouse(warehouseId: string) {
  return runAction("wms:edit", async (user) => {
    const wh = await db.warehouse.findUnique({
      where: { id: warehouseId },
      include: { _count: { select: { inventories: true, inboundOrders: true, outboundOrders: true, purchaseOrders: true, salesOrders: true, stockMovements: true } } },
    });
    if (!wh) throw new Error("仓库不存在");
    const c = wh._count;
    if (c.inventories || c.inboundOrders || c.outboundOrders || c.purchaseOrders || c.salesOrders || c.stockMovements) {
      throw new Error("仓库已有库存或业务单据，不能删除，可改为停用");
    }
    await db.warehouse.delete({ where: { id: wh.id } });
    await audit(db, { entityType: "warehouse", entityId: wh.id, action: "deleted", detail: wh.name, userId: user.id });
    refresh();
  });
}

const locationSchema = z.object({
  id: z.string().optional().nullable(),
  warehouseId: id,
  code: z.string().trim().min(1, "请填写库位编码").max(30, "编码不能超过 30 个字符"),
  zone: optText(30),
  type: z.enum(["storage", "picking", "staging"], { error: "请选择库位类型" }),
});

export async function saveLocation(input: { id?: string | null; warehouseId: string; code: string; zone?: string; type: string }) {
  return runAction("wms:edit", async () => {
    const d = parse(locationSchema, input);
    const code = d.code.toUpperCase();
    const dup = await db.location.findFirst({ where: { warehouseId: d.warehouseId, code, ...(d.id ? { NOT: { id: d.id } } : {}) } });
    if (dup) throw new Error(`库位编码 ${code} 在该仓库中已存在`);
    const data = { code, zone: d.zone || null, type: d.type };
    if (d.id) {
      const loc = await db.location.findUnique({ where: { id: d.id } });
      if (!loc || loc.warehouseId !== d.warehouseId) throw new Error("库位不存在");
      await db.location.update({ where: { id: d.id }, data });
    } else {
      await db.location.create({ data: { ...data, warehouseId: d.warehouseId } });
    }
    refresh();
  });
}

export async function deleteLocation(locationId: string) {
  return runAction("wms:edit", async () => {
    const loc = await db.location.findUnique({ where: { id: locationId } });
    if (!loc) throw new Error("库位不存在");
    await db.location.delete({ where: { id: loc.id } });
    refresh();
  });
}
