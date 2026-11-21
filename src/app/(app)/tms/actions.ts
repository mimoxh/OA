"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { can, type CurrentUser } from "@/lib/auth/dal";
import { nextNo } from "@/lib/sequence";
import { parseDateInput } from "@/lib/format";
import { addTransportEvent, assignTransport, cancelTransport, deliverTransport, departTransport } from "@/lib/services/flows";
import { audit } from "@/lib/services/notify";
import { parse } from "@/lib/wms/parse";

function refresh() {
  revalidatePath("/", "layout");
}

const optText = (max = 200) => z.string().trim().max(max, `内容不能超过 ${max} 字`).optional().nullable();

/** 调度员（tms:edit）可操作全部运输单；司机只能操作指派给自己的运输单 */
async function assertOperator(user: CurrentUser, orderId: string) {
  const order = await db.transportOrder.findUnique({ where: { id: orderId }, include: { driver: { select: { userId: true } } } });
  if (!order) throw new Error("运输单不存在");
  if (can(user, "tms:edit")) return order;
  if (!order.driver?.userId || order.driver.userId !== user.id) throw new Error("只能操作指派给自己的运输任务");
  return order;
}

// ───────────── 运输单 ─────────────

const createSchema = z.object({
  origin: z.string().trim().min(1, "请填写起点").max(200, "起点不能超过 200 字"),
  destination: z.string().trim().min(1, "请填写终点").max(200, "终点不能超过 200 字"),
  consignee: optText(50),
  consigneePhone: optText(30),
  weight: z.coerce.number({ error: "请填写货物重量" }).min(0, "重量不能为负数").max(100000, "重量超出范围"),
  customerId: z.string().optional().nullable(),
  remark: optText(500),
});

export async function createTransport(input: {
  origin: string;
  destination: string;
  consignee?: string;
  consigneePhone?: string;
  weight: number | string;
  customerId?: string | null;
  remark?: string;
}) {
  return runAction("tms:edit", async (user) => {
    const d = parse(createSchema, input);
    const order = await db.$transaction(async (tx) => {
      const o = await tx.transportOrder.create({
        data: {
          no: await nextNo(tx, "TO"),
          origin: d.origin,
          destination: d.destination,
          consignee: d.consignee || null,
          consigneePhone: d.consigneePhone || null,
          weight: Math.round(d.weight * 100) / 100,
          customerId: d.customerId || null,
          remark: d.remark || null,
          events: { create: { status: "PENDING", note: "手工创建运输单，等待调度", userId: user.id } },
        },
      });
      await audit(tx, { entityType: "transport", entityId: o.id, action: "created", userId: user.id });
      return o;
    });
    refresh();
    return { id: order.id };
  });
}

const assignSchema = z.object({
  orderId: z.string().min(1),
  vehicleId: z.string().min(1, "请选择车辆"),
  driverId: z.string().min(1, "请选择司机"),
  routeId: z.string().optional().nullable(),
  plannedAt: z.string().optional().nullable(),
  freightCost: z.coerce.number({ error: "运费格式不正确" }).min(0, "运费不能为负数").max(10_000_000, "运费超出范围"),
});

export async function dispatchTransport(input: {
  orderId: string;
  vehicleId: string;
  driverId: string;
  routeId?: string | null;
  plannedAt?: string | null;
  freightCost: number | string;
}) {
  return runAction("tms:edit", async (user) => {
    const d = parse(assignSchema, input);
    await db.$transaction((tx) =>
      assignTransport(tx, {
        orderId: d.orderId,
        vehicleId: d.vehicleId,
        driverId: d.driverId,
        routeId: d.routeId || null,
        plannedAt: parseDateInput(d.plannedAt),
        freightCost: Math.round(d.freightCost * 100) / 100,
        userId: user.id,
      }),
    );
    refresh();
  });
}

export async function departOrder(input: { orderId: string; location?: string }) {
  return runAction("tms:view", async (user) => {
    const d = parse(z.object({ orderId: z.string().min(1), location: optText(200) }), input);
    await assertOperator(user, d.orderId);
    await db.$transaction((tx) => departTransport(tx, { orderId: d.orderId, userId: user.id, location: d.location || undefined }));
    refresh();
  });
}

export async function reportPosition(input: { orderId: string; location: string; note?: string }) {
  return runAction("tms:view", async (user) => {
    const d = parse(
      z.object({
        orderId: z.string().min(1),
        location: z.string().trim().min(1, "请填写当前位置").max(200, "位置不能超过 200 字"),
        note: optText(300),
      }),
      input,
    );
    await assertOperator(user, d.orderId);
    await db.$transaction((tx) => addTransportEvent(tx, { orderId: d.orderId, userId: user.id, location: d.location, note: d.note || "在途位置上报" }));
    refresh();
  });
}

export async function signOrder(input: { orderId: string; note?: string }) {
  return runAction("tms:view", async (user) => {
    const d = parse(z.object({ orderId: z.string().min(1), note: optText(300) }), input);
    await assertOperator(user, d.orderId);
    await db.$transaction((tx) => deliverTransport(tx, { orderId: d.orderId, userId: user.id, note: d.note || undefined }));
    refresh();
  });
}

export async function cancelOrder(input: { orderId: string; reason?: string }) {
  return runAction("tms:edit", async (user) => {
    const d = parse(z.object({ orderId: z.string().min(1), reason: optText(300) }), input);
    await db.$transaction(async (tx) => {
      await cancelTransport(tx, { orderId: d.orderId, userId: user.id, reason: d.reason || undefined });
      await audit(tx, { entityType: "transport", entityId: d.orderId, action: "cancelled", detail: d.reason ?? undefined, userId: user.id });
    });
    refresh();
  });
}

// ───────────── 车辆 ─────────────

const vehicleSchema = z.object({
  id: z.string().optional().nullable(),
  plateNo: z.string().trim().min(1, "请填写车牌号").max(20, "车牌号不能超过 20 个字符"),
  type: z.string().trim().min(1, "请填写车型").max(30, "车型不能超过 30 字"),
  capacity: z.coerce.number({ error: "请填写载重" }).positive("载重必须大于 0").max(100000, "载重超出范围"),
  status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE"], { error: "请选择状态" }),
  remark: optText(200),
});

export async function saveVehicle(input: {
  id?: string | null;
  plateNo: string;
  type: string;
  capacity: number | string;
  status: string;
  remark?: string;
}) {
  return runAction("tms:edit", async (user) => {
    const d = parse(vehicleSchema, input);
    const plateNo = d.plateNo.toUpperCase();
    const dup = await db.vehicle.findFirst({ where: { plateNo, ...(d.id ? { NOT: { id: d.id } } : {}) } });
    if (dup) throw new Error(`车牌号 ${plateNo} 已存在`);
    if (d.id) {
      const current = await db.vehicle.findUnique({ where: { id: d.id } });
      if (!current) throw new Error("车辆不存在");
      const inTransit = await db.transportOrder.count({ where: { vehicleId: d.id, status: "IN_TRANSIT" } });
      if (inTransit && d.status !== "IN_USE") throw new Error("车辆正在运输中，签收后才能修改状态");
      if (!inTransit && d.status === "IN_USE") throw new Error("“运输中”状态由发车自动设置，不能手工设置");
    } else if (d.status === "IN_USE") {
      throw new Error("“运输中”状态由发车自动设置，不能手工设置");
    }
    const data = { plateNo, type: d.type, capacity: d.capacity, status: d.status, remark: d.remark || null };
    const v = d.id ? await db.vehicle.update({ where: { id: d.id }, data }) : await db.vehicle.create({ data });
    await audit(db, { entityType: "vehicle", entityId: v.id, action: d.id ? "updated" : "created", userId: user.id });
    refresh();
  });
}

export async function deleteVehicle(vehicleId: string) {
  return runAction("tms:edit", async (user) => {
    const v = await db.vehicle.findUnique({ where: { id: vehicleId }, include: { _count: { select: { orders: true } } } });
    if (!v) throw new Error("车辆不存在");
    if (v._count.orders) throw new Error("车辆已有运输记录，不能删除，可设置为维修保养");
    await db.vehicle.delete({ where: { id: v.id } });
    await audit(db, { entityType: "vehicle", entityId: v.id, action: "deleted", detail: v.plateNo, userId: user.id });
    refresh();
  });
}

// ───────────── 司机 ─────────────

const driverSchema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().trim().min(1, "请填写姓名").max(30, "姓名不能超过 30 字"),
  phone: z
    .string()
    .trim()
    .min(1, "请填写电话")
    .regex(/^[0-9+\-\s]{5,20}$/, "电话格式不正确"),
  licenseNo: optText(30),
  status: z.enum(["AVAILABLE", "ON_DUTY", "OFF"], { error: "请选择状态" }),
  userId: z.string().optional().nullable(),
});

export async function saveDriver(input: {
  id?: string | null;
  name: string;
  phone: string;
  licenseNo?: string;
  status: string;
  userId?: string | null;
}) {
  return runAction("tms:edit", async (user) => {
    const d = parse(driverSchema, input);
    const userId = d.userId || null;
    if (userId) {
      const bound = await db.driver.findFirst({ where: { userId, ...(d.id ? { NOT: { id: d.id } } : {}) } });
      if (bound) throw new Error(`该账号已关联司机「${bound.name}」`);
    }
    if (d.id) {
      const inTransit = await db.transportOrder.count({ where: { driverId: d.id, status: "IN_TRANSIT" } });
      if (inTransit && d.status !== "ON_DUTY") throw new Error("司机正在运输中，签收后才能修改状态");
    }
    const data = { name: d.name, phone: d.phone, licenseNo: d.licenseNo || null, status: d.status, userId };
    const drv = d.id ? await db.driver.update({ where: { id: d.id }, data }) : await db.driver.create({ data });
    await audit(db, { entityType: "driver", entityId: drv.id, action: d.id ? "updated" : "created", userId: user.id });
    refresh();
  });
}

export async function deleteDriver(driverId: string) {
  return runAction("tms:edit", async (user) => {
    const drv = await db.driver.findUnique({ where: { id: driverId }, include: { _count: { select: { orders: true } } } });
    if (!drv) throw new Error("司机不存在");
    if (drv._count.orders) throw new Error("司机已有运输记录，不能删除，可设置为休息");
    await db.driver.delete({ where: { id: drv.id } });
    await audit(db, { entityType: "driver", entityId: drv.id, action: "deleted", detail: drv.name, userId: user.id });
    refresh();
  });
}

// ───────────── 线路 ─────────────

const routeSchema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().trim().min(1, "请填写线路名称").max(50, "名称不能超过 50 字"),
  origin: z.string().trim().min(1, "请填写起点").max(100, "起点不能超过 100 字"),
  destination: z.string().trim().min(1, "请填写终点").max(100, "终点不能超过 100 字"),
  distanceKm: z.coerce.number({ error: "里程格式不正确" }).min(0, "里程不能为负数").max(100000, "里程超出范围"),
  estimatedHours: z.coerce.number({ error: "预计时长格式不正确" }).min(0, "预计时长不能为负数").max(1000, "预计时长超出范围"),
  stops: z.array(z.string().trim().max(50, "途经点不能超过 50 字")).max(20, "途经点最多 20 个"),
});

export async function saveRoute(input: {
  id?: string | null;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number | string;
  estimatedHours: number | string;
  stops: string[];
}) {
  return runAction("tms:edit", async (user) => {
    const d = parse(routeSchema, input);
    const data = {
      name: d.name,
      origin: d.origin,
      destination: d.destination,
      distanceKm: d.distanceKm,
      estimatedHours: d.estimatedHours,
      stops: JSON.stringify(d.stops.filter(Boolean)),
    };
    const r = d.id ? await db.route.update({ where: { id: d.id }, data }) : await db.route.create({ data });
    await audit(db, { entityType: "route", entityId: r.id, action: d.id ? "updated" : "created", userId: user.id });
    refresh();
  });
}

export async function deleteRoute(routeId: string) {
  return runAction("tms:edit", async (user) => {
    const r = await db.route.findUnique({ where: { id: routeId } });
    if (!r) throw new Error("线路不存在");
    const active = await db.transportOrder.count({ where: { routeId, status: { in: ["ASSIGNED", "IN_TRANSIT"] } } });
    if (active) throw new Error("有进行中的运输单使用该线路，不能删除");
    await db.$transaction(async (tx) => {
      await tx.transportOrder.updateMany({ where: { routeId }, data: { routeId: null } });
      await tx.route.delete({ where: { id: routeId } });
    });
    await audit(db, { entityType: "route", entityId: r.id, action: "deleted", detail: r.name, userId: user.id });
    refresh();
  });
}
