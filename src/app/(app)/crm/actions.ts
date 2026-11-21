"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { hasPermission } from "@/lib/permissions";
import { nextCode } from "@/lib/sequence";
import { audit, notify } from "@/lib/services/notify";
import { createSalesOrderFromOpportunity } from "@/lib/services/flows";
import { OPPORTUNITY_STAGE, OPPORTUNITY_STAGE_PROBABILITY } from "@/lib/labels";
import { parseDateInput } from "@/lib/format";
import { parseInput, pickProvided } from "@/lib/crm/validate";

const optStr = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `内容不能超过 ${max} 个字符`)
    .nullish()
    .transform((v) => (v ? v : null));

const optDate = z
  .string()
  .nullish()
  .transform((v) => parseDateInput(v ?? null));

const STAGES = ["QUALIFY", "NEEDS", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
const FOLLOWUP_TYPES = ["call", "visit", "email", "meeting", "wechat"] as const;

const customerSchema = z.object({
  name: z.string().trim().min(1, "请填写客户名称").max(100, "客户名称过长"),
  industry: optStr(50),
  level: z.enum(["A", "B", "C"], { error: "请选择客户等级" }),
  status: z.enum(["LEAD", "PROSPECT", "CUSTOMER", "LOST"], { error: "请选择客户状态" }),
  source: optStr(50),
  phone: optStr(50),
  email: optStr(100).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "邮箱格式不正确"),
  address: optStr(200),
  remark: optStr(2000),
  ownerId: optStr(50),
});

export type CustomerInput = z.input<typeof customerSchema>;

function revalidateCrm() {
  revalidatePath("/crm", "layout");
}

// ───────────── 客户 ─────────────

export async function createCustomer(input: CustomerInput) {
  return runAction("crm:edit", async (user) => {
    const data = parseInput(customerSchema, input);
    const exists = await db.customer.findFirst({ where: { name: data.name } });
    if (exists) throw new Error(`客户「${data.name}」已存在（${exists.code}）`);
    const customer = await db.$transaction(async (tx) => {
      const code = await nextCode(tx, "CUS");
      const c = await tx.customer.create({ data: { ...data, code } });
      await audit(tx, { entityType: "customer", entityId: c.id, action: "created", detail: c.name, userId: user.id });
      await notify(tx, {
        userIds: [c.ownerId],
        actorId: user.id,
        type: "system",
        title: `${user.name} 将客户「${c.name}」指派给你`,
        link: `/crm/customers/${c.id}`,
      });
      return c;
    });
    revalidateCrm();
    return { id: customer.id };
  });
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>) {
  return runAction("crm:edit", async (user) => {
    const data = parseInput(customerSchema.partial(), input);
    const before = await db.customer.findUnique({ where: { id } });
    if (!before) throw new Error("客户不存在");
    const patch = pickProvided(data, input);
    await db.$transaction(async (tx) => {
      const c = await tx.customer.update({ where: { id }, data: patch });
      await audit(tx, { entityType: "customer", entityId: id, action: "updated", detail: Object.keys(patch).join(","), userId: user.id });
      if (patch.ownerId && patch.ownerId !== before.ownerId) {
        await notify(tx, {
          userIds: [c.ownerId],
          actorId: user.id,
          type: "system",
          title: `${user.name} 将客户「${c.name}」指派给你`,
          link: `/crm/customers/${c.id}`,
        });
      }
    });
    revalidateCrm();
  });
}

export async function deleteCustomer(id: string) {
  return runAction("crm:edit", async (user) => {
    const c = await db.customer.findUnique({ where: { id }, include: { _count: { select: { salesOrders: true } } } });
    if (!c) throw new Error("客户不存在");
    if (c._count.salesOrders > 0) throw new Error(`客户「${c.name}」已有 ${c._count.salesOrders} 张销售订单，不能删除`);
    await db.$transaction(async (tx) => {
      await tx.customer.delete({ where: { id } });
      await audit(tx, { entityType: "customer", entityId: id, action: "deleted", detail: c.name, userId: user.id });
    });
    revalidateCrm();
  });
}

// ───────────── 联系人 ─────────────

const contactSchema = z.object({
  name: z.string().trim().min(1, "请填写联系人姓名").max(50),
  title: optStr(50),
  phone: optStr(50),
  email: optStr(100).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "邮箱格式不正确"),
  isPrimary: z.boolean().optional(),
});
export type ContactInput = z.input<typeof contactSchema>;

export async function createContact(customerId: string, input: ContactInput) {
  return runAction("crm:edit", async () => {
    const data = parseInput(contactSchema, input);
    await db.$transaction(async (tx) => {
      const count = await tx.contact.count({ where: { customerId } });
      const isPrimary = data.isPrimary || count === 0;
      if (isPrimary) await tx.contact.updateMany({ where: { customerId }, data: { isPrimary: false } });
      await tx.contact.create({ data: { ...data, customerId, isPrimary } });
    });
    revalidateCrm();
  });
}

export async function updateContact(id: string, input: ContactInput) {
  return runAction("crm:edit", async () => {
    const data = parseInput(contactSchema, input);
    await db.$transaction(async (tx) => {
      const c = await tx.contact.findUnique({ where: { id } });
      if (!c) throw new Error("联系人不存在");
      if (data.isPrimary) await tx.contact.updateMany({ where: { customerId: c.customerId }, data: { isPrimary: false } });
      await tx.contact.update({ where: { id }, data: { ...data, isPrimary: data.isPrimary ?? c.isPrimary } });
    });
    revalidateCrm();
  });
}

export async function setPrimaryContact(id: string) {
  return runAction("crm:edit", async () => {
    await db.$transaction(async (tx) => {
      const c = await tx.contact.findUnique({ where: { id } });
      if (!c) throw new Error("联系人不存在");
      await tx.contact.updateMany({ where: { customerId: c.customerId }, data: { isPrimary: false } });
      await tx.contact.update({ where: { id }, data: { isPrimary: true } });
    });
    revalidateCrm();
  });
}

export async function deleteContact(id: string) {
  return runAction("crm:edit", async () => {
    await db.$transaction(async (tx) => {
      const c = await tx.contact.delete({ where: { id } });
      if (c.isPrimary) {
        const next = await tx.contact.findFirst({ where: { customerId: c.customerId }, orderBy: { createdAt: "asc" } });
        if (next) await tx.contact.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
    revalidateCrm();
  });
}

// ───────────── 跟进记录 ─────────────

const followUpSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  opportunityId: optStr(50),
  type: z.enum(FOLLOWUP_TYPES, { error: "请选择跟进方式" }),
  content: z.string().trim().min(1, "请填写跟进内容").max(2000, "跟进内容过长"),
  nextAt: optDate,
});
export type FollowUpInput = z.input<typeof followUpSchema>;

export async function createFollowUp(input: FollowUpInput) {
  return runAction("crm:edit", async (user) => {
    const data = parseInput(followUpSchema, input);
    const customer = await db.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new Error("客户不存在");
    if (data.opportunityId) {
      const opp = await db.opportunity.findUnique({ where: { id: data.opportunityId } });
      if (!opp || opp.customerId !== customer.id) throw new Error("关联商机不属于该客户");
    }
    await db.$transaction(async (tx) => {
      await tx.followUp.create({ data: { ...data, userId: user.id } });
      if (customer.status === "LEAD") await tx.customer.update({ where: { id: customer.id }, data: { status: "PROSPECT" } });
      await tx.customer.update({ where: { id: customer.id }, data: { updatedAt: new Date() } });
    });
    revalidateCrm();
  });
}

export async function deleteFollowUp(id: string) {
  return runAction("crm:edit", async (user) => {
    const f = await db.followUp.findUnique({ where: { id } });
    if (!f) throw new Error("跟进记录不存在");
    if (f.userId !== user.id && !hasPermission(user.permissions, "admin")) throw new Error("只能删除自己的跟进记录");
    await db.followUp.delete({ where: { id } });
    revalidateCrm();
  });
}

// ───────────── 商机 ─────────────

const opportunitySchema = z.object({
  name: z.string().trim().min(1, "请填写商机名称").max(100),
  customerId: z.string().min(1, "请选择客户"),
  amount: z.coerce.number({ error: "请输入正确的金额" }).min(0, "金额不能为负数"),
  stage: z.enum(STAGES),
  expectedCloseDate: optDate,
  ownerId: optStr(50),
});
export type OpportunityInput = z.input<typeof opportunitySchema>;

export async function createOpportunity(input: OpportunityInput) {
  return runAction("crm:edit", async (user) => {
    const data = parseInput(opportunitySchema, input);
    if (data.stage === "LOST") throw new Error("新建商机不能直接为输单状态");
    const opp = await db.$transaction(async (tx) => {
      const max = await tx.opportunity.aggregate({ where: { stage: data.stage }, _max: { sortOrder: true } });
      const o = await tx.opportunity.create({
        data: { ...data, probability: OPPORTUNITY_STAGE_PROBABILITY[data.stage], sortOrder: (max._max.sortOrder ?? 0) + 1 },
      });
      await tx.customer.updateMany({ where: { id: data.customerId, status: "LEAD" }, data: { status: "PROSPECT" } });
      await audit(tx, { entityType: "opportunity", entityId: o.id, action: "created", detail: o.name, userId: user.id });
      await notify(tx, {
        userIds: [o.ownerId],
        actorId: user.id,
        type: "system",
        title: `${user.name} 将商机「${o.name}」指派给你`,
        link: `/crm/opportunities/${o.id}`,
      });
      return o;
    });
    revalidateCrm();
    return { id: opp.id };
  });
}

const opportunityPatchSchema = opportunitySchema.omit({ stage: true }).partial().extend({
  probability: z.coerce.number().int().min(0, "赢率范围 0-100").max(100, "赢率范围 0-100").optional(),
});

export async function updateOpportunity(id: string, input: z.input<typeof opportunityPatchSchema>) {
  return runAction("crm:edit", async (user) => {
    const data = parseInput(opportunityPatchSchema, input);
    const patch = pickProvided(data, input);
    await db.$transaction(async (tx) => {
      await tx.opportunity.update({ where: { id }, data: patch });
      await audit(tx, { entityType: "opportunity", entityId: id, action: "updated", detail: Object.keys(patch).join(","), userId: user.id });
    });
    revalidateCrm();
  });
}

export async function changeOpportunityStage(id: string, stage: (typeof STAGES)[number], lostReason?: string) {
  return runAction("crm:edit", async (user) => {
    const s = parseInput(z.enum(STAGES), stage);
    const reason = (lostReason ?? "").trim();
    if (s === "LOST" && !reason) throw new Error("请填写输单原因");
    const opp = await db.opportunity.findUnique({ where: { id } });
    if (!opp) throw new Error("商机不存在");
    if (opp.stage === s) return;
    await db.$transaction(async (tx) => {
      const max = await tx.opportunity.aggregate({ where: { stage: s }, _max: { sortOrder: true } });
      await tx.opportunity.update({
        where: { id },
        data: {
          stage: s,
          probability: OPPORTUNITY_STAGE_PROBABILITY[s],
          lostReason: s === "LOST" ? reason : null,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
        },
      });
      if (s === "WON") await tx.customer.update({ where: { id: opp.customerId }, data: { status: "CUSTOMER" } });
      await audit(tx, {
        entityType: "opportunity",
        entityId: id,
        action: "stage_changed",
        detail: `${OPPORTUNITY_STAGE[opp.stage].label} → ${OPPORTUNITY_STAGE[s].label}${reason ? `：${reason}` : ""}`,
        userId: user.id,
      });
      if (opp.ownerId && opp.ownerId !== user.id) {
        await notify(tx, {
          userIds: [opp.ownerId],
          actorId: user.id,
          type: "system",
          title: `商机「${opp.name}」阶段变更为「${OPPORTUNITY_STAGE[s].label}」`,
          link: `/crm/opportunities/${opp.id}`,
        });
      }
    });
    revalidateCrm();
  });
}

export async function deleteOpportunity(id: string) {
  return runAction("crm:edit", async (user) => {
    const opp = await db.opportunity.findUnique({ where: { id }, include: { _count: { select: { salesOrders: true } } } });
    if (!opp) throw new Error("商机不存在");
    if (opp._count.salesOrders > 0) throw new Error("该商机已转化销售订单，不能删除");
    await db.$transaction(async (tx) => {
      await tx.opportunity.delete({ where: { id } });
      await audit(tx, { entityType: "opportunity", entityId: id, action: "deleted", detail: opp.name, userId: user.id });
    });
    revalidateCrm();
  });
}

const convertSchema = z.object({
  opportunityId: z.string().min(1),
  warehouseId: z.string().min(1, "请选择发货仓库"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "请选择产品"),
        quantity: z.coerce.number().int("数量必须为整数").positive("数量必须大于 0"),
        price: z.coerce.number().min(0, "单价不能为负数"),
      }),
    )
    .min(1, "请至少添加一个产品"),
  shippingAddress: optStr(200),
  consignee: optStr(50),
  consigneePhone: optStr(50),
  remark: optStr(500),
});
export type ConvertInput = z.input<typeof convertSchema>;

export async function convertOpportunityToOrder(input: ConvertInput) {
  return runAction("erp:edit", async (user) => {
    if (!hasPermission(user.permissions, "crm:view")) throw new Error("没有权限执行该操作");
    const data = parseInput(convertSchema, input);
    const ids = data.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new Error("同一产品请合并为一行");
    const warehouse = await db.warehouse.findUnique({ where: { id: data.warehouseId } });
    if (!warehouse || !warehouse.active) throw new Error("发货仓库不可用");
    const order = await db.$transaction(async (tx) => {
      const o = await createSalesOrderFromOpportunity(tx, {
        opportunityId: data.opportunityId,
        warehouseId: data.warehouseId,
        userId: user.id,
        items: data.items,
        shippingAddress: data.shippingAddress ?? undefined,
        consignee: data.consignee ?? undefined,
        consigneePhone: data.consigneePhone ?? undefined,
        remark: data.remark ?? undefined,
      });
      await notify(tx, {
        userIds: [(await tx.opportunity.findUnique({ where: { id: data.opportunityId } }))?.ownerId],
        actorId: user.id,
        type: "order",
        title: `商机已转为销售订单 ${o.no}`,
        link: `/erp/sales/${o.id}`,
      });
      return o;
    });
    revalidateCrm();
    revalidatePath("/erp", "layout");
    return { id: order.id, no: order.no };
  });
}
