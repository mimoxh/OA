import type { Tx } from "@/lib/db";
import { nextNo } from "@/lib/sequence";
import { audit, notify } from "@/lib/services/notify";
import { moveStock, releaseStock, reserveStock } from "@/lib/services/inventory";
import { ACCOUNT, postJournal } from "@/lib/services/ledger";

/*
 * 跨模块业务流程编排（全部要求在事务内调用）：
 *
 * 采购：PurchaseOrder(DRAFT) → 提交审批(PENDING_APPROVAL) → 审批通过 onPurchaseApproved(APPROVED, 生成入库单)
 *      → receiveInbound(入库、回写采购单、生成应付发票、凭证：借库存商品 贷应付账款)
 *      → recordPayment(付款、凭证：借应付账款 贷银行存款，付清后采购单 CLOSED)
 *
 * 销售：Opportunity → createSalesOrderFromOpportunity(SalesOrder DRAFT)
 *      → confirmSalesOrder(预占库存、生成出库单, CONFIRMED)
 *      → shipOutbound(扣减库存、凭证：借主营业务成本 贷库存商品、生成运输单, SHIPPED)
 *      → assignTransport → departTransport → deliverTransport(DELIVERED、应收发票、凭证：借应收账款 贷主营业务收入)
 *      → recordPayment(收款、凭证：借银行存款 贷应收账款，收清后销售单 COMPLETED)
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcTotal(items: { quantity: number; price: number }[]) {
  return round2(items.reduce((s, i) => s + i.quantity * i.price, 0));
}

// ───────────────────────── 采购 → 入库 → 应付 ─────────────────────────

export async function onPurchaseApproved(tx: Tx, purchaseOrderId: string, userId: string) {
  const po = await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: "APPROVED" },
    include: { items: true, warehouse: true },
  });
  const inbound = await tx.inboundOrder.create({
    data: {
      no: await nextNo(tx, "IN"),
      warehouseId: po.warehouseId,
      type: "PURCHASE",
      purchaseOrderId: po.id,
      expectedDate: po.expectedDate,
      remark: `采购单 ${po.no} 审批通过自动生成`,
      createdById: userId,
      items: {
        create: po.items
          .filter((i) => i.quantity > i.receivedQty)
          .map((i) => ({
            productId: i.productId,
            expectedQty: i.quantity - i.receivedQty,
            purchaseItemId: i.id,
          })),
      },
    },
  });
  await notify(tx, {
    userIds: [po.warehouse.managerId, po.createdById],
    actorId: userId,
    type: "order",
    title: `采购单 ${po.no} 已审批通过，入库单 ${inbound.no} 待收货`,
    link: `/wms/inbound/${inbound.id}`,
  });
  await audit(tx, { entityType: "purchase_order", entityId: po.id, action: "approved", userId });
  return inbound;
}

export async function receiveInbound(
  tx: Tx,
  input: {
    inboundId: string;
    userId: string;
    items: { id: string; receivedQty: number; locationId?: string | null }[];
  },
) {
  const inbound = await tx.inboundOrder.findUnique({
    where: { id: input.inboundId },
    include: { items: { include: { product: true } }, purchaseOrder: { include: { items: true } } },
  });
  if (!inbound) throw new Error("入库单不存在");
  if (inbound.status !== "PENDING") throw new Error("入库单已处理");

  const receiptMap = new Map(input.items.map((i) => [i.id, i]));
  let receivedValue = 0;
  let anyReceived = false;

  for (const item of inbound.items) {
    const r = receiptMap.get(item.id);
    const qty = Math.max(0, Math.floor(r?.receivedQty ?? 0));
    if (qty > item.expectedQty) throw new Error(`「${item.product.name}」实收数量不能超过应收数量 ${item.expectedQty}`);
    await tx.inboundItem.update({
      where: { id: item.id },
      data: { receivedQty: qty, locationId: r?.locationId ?? item.locationId },
    });
    if (qty === 0) continue;
    anyReceived = true;

    // 移动加权平均成本
    const poItem = inbound.purchaseOrder?.items.find((p) => p.id === item.purchaseItemId);
    const unitCost = poItem?.price ?? item.product.cost;
    const totals = await tx.inventory.aggregate({ where: { productId: item.productId }, _sum: { quantity: true } });
    const onHand = totals._sum.quantity ?? 0;
    const newCost = onHand + qty > 0 ? (onHand * item.product.cost + qty * unitCost) / (onHand + qty) : unitCost;
    await tx.product.update({ where: { id: item.productId }, data: { cost: round2(newCost) } });

    await moveStock(tx, {
      productId: item.productId,
      warehouseId: inbound.warehouseId,
      quantity: qty,
      type: "IN",
      refType: "inbound",
      refId: inbound.id,
      refNo: inbound.no,
      memo: inbound.type === "PURCHASE" ? "采购入库" : inbound.type === "RETURN" ? "退货入库" : "其他入库",
      userId: input.userId,
      locationId: r?.locationId ?? null,
    });
    receivedValue += qty * unitCost;

    if (poItem) {
      await tx.purchaseOrderItem.update({ where: { id: poItem.id }, data: { receivedQty: { increment: qty } } });
    }
  }
  if (!anyReceived) throw new Error("请至少填写一项实收数量");

  await tx.inboundOrder.update({
    where: { id: inbound.id },
    data: { status: "COMPLETED", receivedAt: new Date() },
  });

  if (inbound.purchaseOrder) {
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: inbound.purchaseOrder.id },
      include: { items: true },
    });
    const remaining = po.items.filter((i) => i.receivedQty < i.quantity);
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: remaining.length ? "PARTIAL_RECEIVED" : "RECEIVED" },
    });
    // 部分到货：为剩余数量自动生成新的入库单
    if (remaining.length) {
      await tx.inboundOrder.create({
        data: {
          no: await nextNo(tx, "IN"),
          warehouseId: inbound.warehouseId,
          type: "PURCHASE",
          purchaseOrderId: po.id,
          remark: `采购单 ${po.no} 剩余未到货`,
          createdById: input.userId,
          items: {
            create: remaining.map((i) => ({
              productId: i.productId,
              expectedQty: i.quantity - i.receivedQty,
              purchaseItemId: i.id,
            })),
          },
        },
      });
    }
    const amount = round2(receivedValue);
    if (amount > 0) {
      const invoice = await tx.invoice.create({
        data: {
          no: await nextNo(tx, "AP"),
          type: "PAYABLE",
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          amount,
          dueDate: new Date(Date.now() + 30 * 864e5),
          memo: `采购单 ${po.no} 入库 ${inbound.no}`,
        },
      });
      await postJournal(tx, {
        memo: `采购入库 ${inbound.no}（${po.no}）`,
        sourceType: "purchase_inbound",
        sourceId: inbound.id,
        userId: input.userId,
        lines: [
          { account: ACCOUNT.INVENTORY, debit: amount },
          { account: ACCOUNT.AP, credit: amount, memo: `应付 ${invoice.no}` },
        ],
      });
    }
    await notify(tx, {
      userIds: [po.createdById],
      actorId: input.userId,
      type: "order",
      title: `采购单 ${po.no} 已${remaining.length ? "部分" : "全部"}入库`,
      link: `/erp/purchase/${po.id}`,
    });
  }
  await audit(tx, { entityType: "inbound", entityId: inbound.id, action: "received", userId: input.userId });
}

// ───────────────────────── 商机 → 销售 → 出库 → 运输 → 应收 ─────────────────────────

export async function createSalesOrderFromOpportunity(
  tx: Tx,
  input: {
    opportunityId: string;
    warehouseId: string;
    userId: string;
    items: { productId: string; quantity: number; price: number }[];
    shippingAddress?: string;
    consignee?: string;
    consigneePhone?: string;
    remark?: string;
  },
) {
  if (!input.items.length) throw new Error("请至少添加一个产品");
  const opp = await tx.opportunity.findUnique({ where: { id: input.opportunityId }, include: { customer: { include: { contacts: true } } } });
  if (!opp) throw new Error("商机不存在");
  if (opp.stage === "LOST") throw new Error("已输单的商机不能转销售订单");
  const primary = opp.customer.contacts.find((c) => c.isPrimary) ?? opp.customer.contacts[0];
  const order = await tx.salesOrder.create({
    data: {
      no: await nextNo(tx, "SO"),
      customerId: opp.customerId,
      opportunityId: opp.id,
      warehouseId: input.warehouseId,
      totalAmount: calcTotal(input.items),
      shippingAddress: input.shippingAddress ?? opp.customer.address,
      consignee: input.consignee ?? primary?.name ?? opp.customer.name,
      consigneePhone: input.consigneePhone ?? primary?.phone ?? opp.customer.phone,
      remark: input.remark ?? `由商机「${opp.name}」转化`,
      createdById: input.userId,
      items: { create: input.items },
    },
  });
  await tx.opportunity.update({ where: { id: opp.id }, data: { stage: "WON", probability: 100 } });
  await tx.customer.update({ where: { id: opp.customerId }, data: { status: "CUSTOMER" } });
  await audit(tx, { entityType: "sales_order", entityId: order.id, action: "created_from_opportunity", detail: opp.name, userId: input.userId });
  return order;
}

export async function confirmSalesOrder(tx: Tx, input: { salesOrderId: string; userId: string }) {
  const so = await tx.salesOrder.findUnique({ where: { id: input.salesOrderId }, include: { items: true, warehouse: true } });
  if (!so) throw new Error("销售订单不存在");
  if (so.status !== "DRAFT") throw new Error("只有草稿状态的订单可以确认");
  if (!so.items.length) throw new Error("订单没有明细");
  for (const item of so.items) await reserveStock(tx, item.productId, so.warehouseId, item.quantity);
  await tx.salesOrder.update({ where: { id: so.id }, data: { status: "CONFIRMED" } });
  await tx.customer.update({ where: { id: so.customerId }, data: { status: "CUSTOMER" } });
  const outbound = await tx.outboundOrder.create({
    data: {
      no: await nextNo(tx, "OUT"),
      warehouseId: so.warehouseId,
      type: "SALES",
      salesOrderId: so.id,
      remark: `销售订单 ${so.no} 确认自动生成`,
      createdById: input.userId,
      items: {
        create: so.items.map((i) => ({ productId: i.productId, quantity: i.quantity, salesItemId: i.id })),
      },
    },
  });
  await notify(tx, {
    userIds: [so.warehouse.managerId],
    actorId: input.userId,
    type: "order",
    title: `销售订单 ${so.no} 已确认，出库单 ${outbound.no} 待拣货发货`,
    link: `/wms/outbound/${outbound.id}`,
  });
  await audit(tx, { entityType: "sales_order", entityId: so.id, action: "confirmed", userId: input.userId });
  return outbound;
}

export async function cancelSalesOrder(tx: Tx, input: { salesOrderId: string; userId: string }) {
  const so = await tx.salesOrder.findUnique({ where: { id: input.salesOrderId }, include: { items: true, outboundOrders: true } });
  if (!so) throw new Error("销售订单不存在");
  if (so.status === "CONFIRMED") {
    if (so.outboundOrders.some((o) => o.status === "SHIPPED")) throw new Error("已发货的订单不能取消");
    for (const item of so.items) await releaseStock(tx, item.productId, so.warehouseId, item.quantity);
    await tx.outboundOrder.updateMany({
      where: { salesOrderId: so.id, status: { in: ["PENDING", "PICKING"] } },
      data: { status: "CANCELLED" },
    });
  } else if (so.status !== "DRAFT") {
    throw new Error("当前状态的订单不能取消");
  }
  await tx.salesOrder.update({ where: { id: so.id }, data: { status: "CANCELLED" } });
  await audit(tx, { entityType: "sales_order", entityId: so.id, action: "cancelled", userId: input.userId });
}

export async function startPicking(tx: Tx, input: { outboundId: string; userId: string }) {
  const ob = await tx.outboundOrder.findUnique({ where: { id: input.outboundId } });
  if (!ob) throw new Error("出库单不存在");
  if (ob.status !== "PENDING") throw new Error("只有待处理的出库单可以开始拣货");
  await tx.outboundOrder.update({ where: { id: ob.id }, data: { status: "PICKING" } });
  await audit(tx, { entityType: "outbound", entityId: ob.id, action: "picking", userId: input.userId });
}

/** 发货：扣减库存、结转成本；销售出库自动生成运输单 */
export async function shipOutbound(tx: Tx, input: { outboundId: string; userId: string }) {
  const ob = await tx.outboundOrder.findUnique({
    where: { id: input.outboundId },
    include: { items: { include: { product: true } }, warehouse: true, salesOrder: { include: { customer: true } } },
  });
  if (!ob) throw new Error("出库单不存在");
  if (ob.status !== "PENDING" && ob.status !== "PICKING") throw new Error("出库单已处理");

  let cogs = 0;
  let weight = 0;
  for (const item of ob.items) {
    if (ob.type === "SALES") await releaseStock(tx, item.productId, ob.warehouseId, item.quantity);
    await moveStock(tx, {
      productId: item.productId,
      warehouseId: ob.warehouseId,
      quantity: -item.quantity,
      type: "OUT",
      refType: "outbound",
      refId: ob.id,
      refNo: ob.no,
      memo: ob.type === "SALES" ? "销售出库" : "其他出库",
      userId: input.userId,
    });
    await tx.outboundItem.update({ where: { id: item.id }, data: { pickedQty: item.quantity } });
    if (item.salesItemId) {
      await tx.salesOrderItem.update({ where: { id: item.salesItemId }, data: { shippedQty: { increment: item.quantity } } });
    }
    cogs += item.quantity * item.product.cost;
    weight += item.quantity * item.product.weight;
  }
  await tx.outboundOrder.update({ where: { id: ob.id }, data: { status: "SHIPPED", shippedAt: new Date() } });

  let transport = null;
  if (ob.salesOrder) {
    const so = ob.salesOrder;
    await tx.salesOrder.update({ where: { id: so.id }, data: { status: "SHIPPED" } });
    if (round2(cogs) > 0) {
      await postJournal(tx, {
        memo: `销售出库成本结转 ${ob.no}（${so.no}）`,
        sourceType: "sales_shipment",
        sourceId: ob.id,
        userId: input.userId,
        lines: [
          { account: ACCOUNT.COGS, debit: cogs },
          { account: ACCOUNT.INVENTORY, credit: cogs },
        ],
      });
    }
    transport = await tx.transportOrder.create({
      data: {
        no: await nextNo(tx, "TO"),
        outboundOrderId: ob.id,
        salesOrderId: so.id,
        customerId: so.customerId,
        origin: ob.warehouse.address || ob.warehouse.name,
        destination: so.shippingAddress || so.customer.address || "待确认",
        consignee: so.consignee,
        consigneePhone: so.consigneePhone,
        weight: round2(weight),
        remark: `出库单 ${ob.no} 发货自动生成`,
        events: { create: { status: "PENDING", note: "运输单已创建，等待调度", userId: input.userId } },
      },
    });
    await notify(tx, {
      userIds: [so.createdById],
      actorId: input.userId,
      type: "order",
      title: `销售订单 ${so.no} 已出库，运输单 ${transport.no} 待调度`,
      link: `/tms/orders/${transport.id}`,
    });
  }
  await audit(tx, { entityType: "outbound", entityId: ob.id, action: "shipped", userId: input.userId });
  return transport;
}

export async function assignTransport(
  tx: Tx,
  input: {
    orderId: string;
    vehicleId: string;
    driverId: string;
    routeId?: string | null;
    plannedAt?: Date | null;
    freightCost?: number;
    userId: string;
  },
) {
  const order = await tx.transportOrder.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error("运输单不存在");
  if (order.status !== "PENDING" && order.status !== "ASSIGNED") throw new Error("当前状态不能调度");
  const [vehicle, driver] = await Promise.all([
    tx.vehicle.findUnique({ where: { id: input.vehicleId } }),
    tx.driver.findUnique({ where: { id: input.driverId } }),
  ]);
  if (!vehicle) throw new Error("车辆不存在");
  if (!driver) throw new Error("司机不存在");
  if (vehicle.status !== "AVAILABLE" && order.vehicleId !== vehicle.id) throw new Error(`车辆 ${vehicle.plateNo} 不可用`);
  if (driver.status === "OFF") throw new Error(`司机 ${driver.name} 休息中`);
  if (order.weight > vehicle.capacity) throw new Error(`货物重量 ${order.weight}kg 超过车辆载重 ${vehicle.capacity}kg`);
  await tx.transportOrder.update({
    where: { id: order.id },
    data: {
      status: "ASSIGNED",
      vehicleId: vehicle.id,
      driverId: driver.id,
      routeId: input.routeId ?? null,
      plannedAt: input.plannedAt ?? new Date(),
      freightCost: input.freightCost ?? order.freightCost,
      events: {
        create: { status: "ASSIGNED", note: `已调度：车辆 ${vehicle.plateNo}，司机 ${driver.name}`, userId: input.userId },
      },
    },
  });
  await notify(tx, {
    userIds: [driver.userId],
    actorId: input.userId,
    type: "order",
    title: `你有新的运输任务 ${order.no}`,
    body: `${order.origin} → ${order.destination}`,
    link: `/tms/orders/${order.id}`,
  });
}

export async function departTransport(tx: Tx, input: { orderId: string; userId: string; location?: string }) {
  const order = await tx.transportOrder.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error("运输单不存在");
  if (order.status !== "ASSIGNED") throw new Error("只有已调度的运输单可以发车");
  await tx.transportOrder.update({
    where: { id: order.id },
    data: {
      status: "IN_TRANSIT",
      departedAt: new Date(),
      events: { create: { status: "IN_TRANSIT", location: input.location ?? order.origin, note: "已发车", userId: input.userId } },
    },
  });
  if (order.vehicleId) await tx.vehicle.update({ where: { id: order.vehicleId }, data: { status: "IN_USE" } });
  if (order.driverId) await tx.driver.update({ where: { id: order.driverId }, data: { status: "ON_DUTY" } });
}

export async function addTransportEvent(tx: Tx, input: { orderId: string; userId: string; location?: string; note: string }) {
  const order = await tx.transportOrder.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error("运输单不存在");
  if (order.status !== "IN_TRANSIT") throw new Error("只有运输中的订单可以上报位置");
  await tx.transportEvent.create({
    data: { orderId: order.id, status: "TRACKING", location: input.location ?? null, note: input.note, userId: input.userId },
  });
}

export async function deliverTransport(tx: Tx, input: { orderId: string; userId: string; note?: string }) {
  const order = await tx.transportOrder.findUnique({
    where: { id: input.orderId },
    include: { salesOrder: { include: { invoices: true } } },
  });
  if (!order) throw new Error("运输单不存在");
  if (order.status !== "IN_TRANSIT") throw new Error("只有运输中的订单可以签收");
  await tx.transportOrder.update({
    where: { id: order.id },
    data: {
      status: "DELIVERED",
      deliveredAt: new Date(),
      events: {
        create: { status: "DELIVERED", location: order.destination, note: input.note || "客户已签收", userId: input.userId },
      },
    },
  });
  if (order.vehicleId) await tx.vehicle.update({ where: { id: order.vehicleId }, data: { status: "AVAILABLE" } });
  if (order.driverId) await tx.driver.update({ where: { id: order.driverId }, data: { status: "AVAILABLE" } });

  if (order.freightCost > 0) {
    await postJournal(tx, {
      memo: `运费 ${order.no}`,
      sourceType: "freight",
      sourceId: order.id,
      userId: input.userId,
      lines: [
        { account: ACCOUNT.SELLING_EXPENSE, debit: order.freightCost },
        { account: ACCOUNT.BANK, credit: order.freightCost },
      ],
    });
  }

  const so = order.salesOrder;
  if (so) {
    await tx.salesOrder.update({ where: { id: so.id }, data: { status: "DELIVERED" } });
    if (!so.invoices.some((i) => i.type === "RECEIVABLE" && i.status !== "VOID")) {
      const invoice = await tx.invoice.create({
        data: {
          no: await nextNo(tx, "AR"),
          type: "RECEIVABLE",
          customerId: so.customerId,
          salesOrderId: so.id,
          amount: so.totalAmount,
          dueDate: new Date(Date.now() + 30 * 864e5),
          memo: `销售订单 ${so.no} 签收`,
        },
      });
      await postJournal(tx, {
        memo: `销售收入确认 ${so.no}`,
        sourceType: "sales_delivery",
        sourceId: so.id,
        userId: input.userId,
        lines: [
          { account: ACCOUNT.AR, debit: so.totalAmount, memo: `应收 ${invoice.no}` },
          { account: ACCOUNT.REVENUE, credit: so.totalAmount },
        ],
      });
    }
    await notify(tx, {
      userIds: [so.createdById],
      actorId: input.userId,
      type: "order",
      title: `销售订单 ${so.no} 客户已签收，已生成应收账款`,
      link: `/erp/sales/${so.id}`,
    });
  }
  await audit(tx, { entityType: "transport", entityId: order.id, action: "delivered", userId: input.userId });
}

export async function cancelTransport(tx: Tx, input: { orderId: string; userId: string; reason?: string }) {
  const order = await tx.transportOrder.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error("运输单不存在");
  if (order.status === "DELIVERED" || order.status === "IN_TRANSIT") throw new Error("运输中或已签收的运输单不能取消");
  await tx.transportOrder.update({
    where: { id: order.id },
    data: {
      status: "CANCELLED",
      events: { create: { status: "CANCELLED", note: input.reason || "已取消", userId: input.userId } },
    },
  });
}

// ───────────────────────── 收付款 ─────────────────────────

export async function recordPayment(
  tx: Tx,
  input: { invoiceId: string; amount: number; method?: string; memo?: string; paidAt?: Date; userId: string },
) {
  const invoice = await tx.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { salesOrder: true, purchaseOrder: true },
  });
  if (!invoice) throw new Error("发票不存在");
  if (invoice.status === "PAID" || invoice.status === "VOID") throw new Error("该发票已结清或作废");
  const amount = round2(input.amount);
  const remaining = round2(invoice.amount - invoice.paidAmount);
  if (!(amount > 0)) throw new Error("金额必须大于 0");
  if (amount > remaining) throw new Error(`金额不能超过未结金额 ${remaining}`);

  const payment = await tx.payment.create({
    data: {
      no: await nextNo(tx, "PAY"),
      invoiceId: invoice.id,
      amount,
      method: input.method ?? "银行转账",
      memo: input.memo ?? null,
      paidAt: input.paidAt ?? new Date(),
      createdById: input.userId,
    },
  });
  const paidAmount = round2(invoice.paidAmount + amount);
  const status = paidAmount >= invoice.amount ? "PAID" : "PARTIAL";
  await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount, status } });

  const receivable = invoice.type === "RECEIVABLE";
  await postJournal(tx, {
    memo: `${receivable ? "收款" : "付款"} ${payment.no}（${invoice.no}）`,
    sourceType: "payment",
    sourceId: payment.id,
    userId: input.userId,
    lines: receivable
      ? [
          { account: ACCOUNT.BANK, debit: amount },
          { account: ACCOUNT.AR, credit: amount },
        ]
      : [
          { account: ACCOUNT.AP, debit: amount },
          { account: ACCOUNT.BANK, credit: amount },
        ],
  });

  if (status === "PAID") {
    if (invoice.salesOrder && invoice.salesOrder.status === "DELIVERED") {
      await tx.salesOrder.update({ where: { id: invoice.salesOrder.id }, data: { status: "COMPLETED" } });
    }
    if (invoice.purchaseOrder && invoice.purchaseOrder.status === "RECEIVED") {
      const open = await tx.invoice.count({
        where: { purchaseOrderId: invoice.purchaseOrder.id, status: { in: ["UNPAID", "PARTIAL"] } },
      });
      if (open === 0) await tx.purchaseOrder.update({ where: { id: invoice.purchaseOrder.id }, data: { status: "CLOSED" } });
    }
  }
  return payment;
}
