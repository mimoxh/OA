import type { SeedContext } from "../base";
import { db, type Tx } from "@/lib/db";
import { nextNo } from "@/lib/sequence";
import { audit } from "@/lib/services/notify";
import { actOnApproval, startApproval } from "@/lib/services/approval";
import { ACCOUNT, postJournal } from "@/lib/services/ledger";
import {
  assignTransport,
  calcTotal,
  cancelSalesOrder,
  confirmSalesOrder,
  createSalesOrderFromOpportunity,
  deliverTransport,
  departTransport,
  receiveInbound,
  recordPayment,
  shipOutbound,
} from "@/lib/services/flows";

const DAY = 864e5;

function daysAgo(n: number, hour = 10) {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, Math.floor(Math.random() * 50), 0, 0);
  return d;
}

/**
 * 在事务内执行一步业务流程，并把这一步新产生 / 新写入时间戳的记录统一回拨到 date，
 * 使示例数据分布在近几个月（趋势图、逾期提醒才有内容）。
 */
async function at<T>(date: Date, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      const t0 = new Date();
      const result = await fn(tx);
      const since = { gte: t0 };
      const due = new Date(date.getTime() + 30 * DAY);
      await Promise.all([
        tx.purchaseOrder.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.salesOrder.updateMany({ where: { createdAt: since }, data: { createdAt: date, orderDate: date } }),
        tx.inboundOrder.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.inboundOrder.updateMany({ where: { receivedAt: since }, data: { receivedAt: date } }),
        tx.outboundOrder.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.outboundOrder.updateMany({ where: { shippedAt: since }, data: { shippedAt: date } }),
        tx.transportOrder.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.transportOrder.updateMany({ where: { plannedAt: since }, data: { plannedAt: date } }),
        tx.transportOrder.updateMany({ where: { departedAt: since }, data: { departedAt: date } }),
        tx.transportOrder.updateMany({ where: { deliveredAt: since }, data: { deliveredAt: date } }),
        tx.transportEvent.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.invoice.updateMany({ where: { createdAt: since }, data: { createdAt: date, dueDate: due } }),
        tx.payment.updateMany({ where: { createdAt: since }, data: { createdAt: date, paidAt: date } }),
        tx.journalEntry.updateMany({ where: { createdAt: since }, data: { createdAt: date, date } }),
        tx.stockMovement.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.auditLog.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.notification.updateMany({
          where: { createdAt: since },
          data: { createdAt: date, ...(Date.now() - date.getTime() > 7 * DAY ? { read: true } : {}) },
        }),
        tx.approvalInstance.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.approvalInstance.updateMany({ where: { finishedAt: since }, data: { finishedAt: date } }),
        tx.approvalTask.updateMany({ where: { createdAt: since }, data: { createdAt: date } }),
        tx.approvalTask.updateMany({ where: { actedAt: since }, data: { actedAt: date } }),
      ]);
      return result;
    },
    { timeout: 30_000 },
  );
}

type Line = [productIndex: number, quantity: number, price?: number];

export async function seedErp(ctx: SeedContext) {
  const { users, warehouses, products, suppliers, customers, vehicles, drivers, routes } = ctx;
  const sh = warehouses.sh;
  const gz = warehouses.gz;
  const items = (lines: Line[], priceOf: "cost" | "price") =>
    lines.map(([i, quantity, price]) => ({ productId: products[i].id, quantity, price: price ?? products[i][priceOf] }));

  // ───────────────────────── 采购 ─────────────────────────

  async function createPurchase(tx: Tx, input: { supplier: number; warehouseId: string; lines: Line[]; expectedIn: number; remark?: string }) {
    const lines = items(input.lines, "cost");
    const po = await tx.purchaseOrder.create({
      data: {
        no: await nextNo(tx, "PO"),
        supplierId: suppliers[input.supplier].id,
        warehouseId: input.warehouseId,
        totalAmount: calcTotal(lines),
        expectedDate: new Date(Date.now() + input.expectedIn * DAY),
        remark: input.remark ?? null,
        createdById: users.buyer.id,
        items: { create: lines },
      },
    });
    await audit(tx, { entityType: "purchase_order", entityId: po.id, action: "created", userId: users.buyer.id });
    return po;
  }

  async function submitPurchase(tx: Tx, poId: string) {
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: poId },
      include: { items: { include: { product: true } }, supplier: true, warehouse: true },
    });
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: "PENDING_APPROVAL" } });
    const instance = await startApproval(tx, {
      flowKey: "purchase_order",
      title: `采购订单 ${po.no}（${po.supplier.name}）`,
      applicantId: users.buyer.id,
      bizType: "purchase_order",
      bizId: po.id,
      formData: {
        采购单号: po.no,
        供应商: po.supplier.name,
        入库仓库: po.warehouse.name,
        金额: `¥${po.totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`,
        明细: po.items.map((i) => `${i.product.name} × ${i.quantity}${i.product.unit}`).join("；"),
        备注: po.remark ?? "",
      },
    });
    await tx.purchaseOrder.update({ where: { id: poId }, data: { approvalInstanceId: instance.id } });
    await audit(tx, { entityType: "purchase_order", entityId: poId, action: "submitted", userId: users.buyer.id });
    return instance.id;
  }

  /** 依次让当前节点的待处理审批人处理，直到流程结束或达到 maxSteps */
  async function approve(tx: Tx, instanceId: string, opts: { maxSteps?: number; reject?: string } = {}) {
    const comments = ["同意，请尽快安排到货", "预算范围内，同意"];
    for (let step = 0; step < (opts.maxSteps ?? 10); step++) {
      const task = await tx.approvalTask.findFirst({ where: { instanceId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
      if (!task) return;
      await actOnApproval(tx, {
        taskId: task.id,
        userId: task.approverId,
        action: opts.reject ? "REJECT" : "APPROVE",
        comment: opts.reject ?? comments[task.step] ?? "同意",
      });
      if (opts.reject) return;
    }
  }

  async function receiveAll(tx: Tx, poId: string) {
    const inbound = await tx.inboundOrder.findFirstOrThrow({ where: { purchaseOrderId: poId, status: "PENDING" }, include: { items: true } });
    const loc = await tx.location.findFirst({ where: { warehouseId: inbound.warehouseId }, orderBy: { code: "asc" } });
    await receiveInbound(tx, {
      inboundId: inbound.id,
      userId: users.wh.id,
      items: inbound.items.map((i) => ({ id: i.id, receivedQty: i.expectedQty, locationId: loc?.id ?? null })),
    });
  }

  async function payInvoicesOf(tx: Tx, where: { purchaseOrderId?: string; salesOrderId?: string }, ratio: number, memo: string) {
    const invs = await tx.invoice.findMany({ where: { ...where, status: { in: ["UNPAID", "PARTIAL"] } } });
    for (const inv of invs) {
      const amount = Math.round((inv.amount - inv.paidAmount) * ratio * 100) / 100;
      if (amount > 0) await recordPayment(tx, { invoiceId: inv.id, amount, method: "银行转账", memo, userId: users.finance.id });
    }
  }

  // 已结清：入库并全额付款
  const poClosed = await at(daysAgo(150), (tx) =>
    createPurchase(tx, {
      supplier: 0,
      warehouseId: sh.id,
      lines: [
        [0, 20, 5100],
        [2, 60, 205],
        [3, 100, 55],
      ],
      expectedIn: -140,
      remark: "季度电脑及外设备货",
    }),
  );
  await at(daysAgo(149), async (tx) => approve(tx, await submitPurchase(tx, poClosed.id)));
  await at(daysAgo(143), (tx) => receiveAll(tx, poClosed.id));
  await at(daysAgo(120), (tx) => payInvoicesOf(tx, { purchaseOrderId: poClosed.id }, 1, "按合同账期付款"));

  // 已入库，部分付款
  const poReceived = await at(daysAgo(75), (tx) =>
    createPurchase(tx, {
      supplier: 1,
      warehouseId: sh.id,
      lines: [
        [1, 25, 1600],
        [6, 6, 3300],
      ],
      expectedIn: -68,
      remark: "显示器与会议投影仪补货",
    }),
  );
  await at(daysAgo(74), async (tx) => approve(tx, await submitPurchase(tx, poReceived.id)));
  await at(daysAgo(68), (tx) => receiveAll(tx, poReceived.id));
  await at(daysAgo(40), (tx) => payInvoicesOf(tx, { purchaseOrderId: poReceived.id }, 0.5, "首期 50% 货款"));

  // 已驳回
  const poRejected = await at(daysAgo(45), (tx) =>
    createPurchase(tx, { supplier: 2, warehouseId: sh.id, lines: [[4, 30, 960]], expectedIn: -30, remark: "新办公区座椅" }),
  );
  await at(daysAgo(44), async (tx) => approve(tx, await submitPurchase(tx, poRejected.id), { reject: "数量偏多，超出本季度预算，请减少到 15 把以内后重新提交" }));

  // 已审批，待入库（入库单待仓库收货）
  const poApproved = await at(daysAgo(20), (tx) =>
    createPurchase(tx, {
      supplier: 3,
      warehouseId: sh.id,
      lines: [
        [8, 80, 118],
        [9, 150, 90],
      ],
      expectedIn: 3,
      remark: "耗材月度采购，硒鼓已低于安全库存",
    }),
  );
  await at(daysAgo(19), async (tx) => approve(tx, await submitPurchase(tx, poApproved.id)));

  // 审批中：主管已同意，待财务审核
  const poPending = await at(daysAgo(5), (tx) =>
    createPurchase(tx, {
      supplier: 1,
      warehouseId: gz.id,
      lines: [
        [5, 10, 1280],
        [7, 40, 275],
      ],
      expectedIn: 12,
      remark: "广州分仓打印机、路由器备货",
    }),
  );
  await at(daysAgo(4), async (tx) => approve(tx, await submitPurchase(tx, poPending.id), { maxSteps: 1 }));

  // 草稿
  await at(daysAgo(1), (tx) =>
    createPurchase(tx, { supplier: 2, warehouseId: sh.id, lines: [[4, 12, 980]], expectedIn: 15, remark: "修改后的座椅采购（待提交）" }),
  );

  // ───────────────────────── 销售 ─────────────────────────

  async function createSales(tx: Tx, input: { customer: number; warehouseId: string; lines: Line[]; by?: "sales" | "sales2"; remark?: string }) {
    const c = await tx.customer.findUniqueOrThrow({ where: { id: customers[input.customer].id }, include: { contacts: true } });
    const contact = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
    const lines = items(input.lines, "price");
    const userId = users[input.by ?? "sales"].id;
    const so = await tx.salesOrder.create({
      data: {
        no: await nextNo(tx, "SO"),
        customerId: c.id,
        warehouseId: input.warehouseId,
        totalAmount: calcTotal(lines),
        shippingAddress: c.address,
        consignee: contact?.name ?? c.name,
        consigneePhone: contact?.phone ?? c.phone,
        remark: input.remark ?? null,
        createdById: userId,
        items: { create: lines },
      },
    });
    await audit(tx, { entityType: "sales_order", entityId: so.id, action: "created", userId });
    return so;
  }

  const confirm = (soId: string) => (tx: Tx) => confirmSalesOrder(tx, { salesOrderId: soId, userId: users.sales.id });
  const ship = (soId: string) => async (tx: Tx) => {
    const ob = await tx.outboundOrder.findFirstOrThrow({ where: { salesOrderId: soId, status: { in: ["PENDING", "PICKING"] } } });
    return shipOutbound(tx, { outboundId: ob.id, userId: users.wh.id });
  };
  const dispatch = (soId: string, v: number, freightCost: number, routeIdx?: number) => async (tx: Tx) => {
    const to = await tx.transportOrder.findFirstOrThrow({ where: { salesOrderId: soId, status: "PENDING" } });
    await assignTransport(tx, {
      orderId: to.id,
      vehicleId: vehicles[v].id,
      driverId: drivers[v].id,
      routeId: routeIdx === undefined ? null : routes[routeIdx].id,
      freightCost,
      userId: users.dispatch.id,
    });
    await departTransport(tx, { orderId: to.id, userId: users.driver.id });
  };
  const deliver = (soId: string) => async (tx: Tx) => {
    const to = await tx.transportOrder.findFirstOrThrow({ where: { salesOrderId: soId, status: "IN_TRANSIT" } });
    await deliverTransport(tx, { orderId: to.id, userId: users.driver.id, note: "客户已签收，货物完好" });
  };

  async function fullCycle(soId: string, days: [confirm: number, ship: number, deliver: number, pay: number | null], v: number, freight: number, route?: number) {
    await at(daysAgo(days[0]), confirm(soId));
    await at(daysAgo(days[1], 9), ship(soId));
    await at(daysAgo(days[1], 14), dispatch(soId, v, freight, route));
    await at(daysAgo(days[2], 16), deliver(soId));
    if (days[3] !== null) await at(daysAgo(days[3]), (tx) => payInvoicesOf(tx, { salesOrderId: soId }, 1, "客户银行转账"));
  }

  // 已完成（签收并收款）
  const soA = await at(daysAgo(160), (tx) =>
    createSales(tx, {
      customer: 0,
      warehouseId: sh.id,
      lines: [
        [0, 10],
        [1, 10],
      ],
      remark: "研发中心办公设备升级",
    }),
  );
  await fullCycle(soA.id, [159, 157, 156, 140], 0, 600, 0);

  const soB = await at(daysAgo(110), (tx) =>
    createSales(tx, {
      customer: 7,
      warehouseId: sh.id,
      lines: [
        [0, 8, 6800],
        [2, 20],
        [3, 20],
      ],
      remark: "新员工入职套装",
    }),
  );
  await fullCycle(soB.id, [109, 106, 104, 85], 1, 1200);

  const soC = await at(daysAgo(35), (tx) =>
    createSales(tx, {
      customer: 2,
      by: "sales2",
      warehouseId: sh.id,
      lines: [
        [4, 6],
        [5, 2],
      ],
    }),
  );
  await fullCycle(soC.id, [34, 33, 32, 12], 0, 450, 0);

  // 已签收未收款（应收已逾期）
  const soD = await at(daysAgo(52), (tx) =>
    createSales(tx, {
      customer: 2,
      by: "sales2",
      warehouseId: sh.id,
      lines: [
        [0, 5],
        [7, 10],
      ],
      remark: "客户要求月结 30 天",
    }),
  );
  await fullCycle(soD.id, [51, 50, 49, null], 2, 380, 0);

  // 已发货，运输单待调度
  const soF = await at(daysAgo(3), (tx) =>
    createSales(tx, {
      customer: 0,
      warehouseId: sh.id,
      lines: [
        [7, 20],
        [8, 10],
      ],
    }),
  );
  await at(daysAgo(3), confirm(soF.id));
  await at(daysAgo(2), ship(soF.id));

  // 由商机转化（若 CRM 有谈判中的商机），否则直接按客户创建
  const opps = await db.opportunity.findMany({ where: { stage: "NEGOTIATION" }, orderBy: { amount: "desc" }, take: 2 });
  const fromOpp = async (idx: number, lines: Line[], fallbackCustomer: number, days: number) => {
    const opp = opps[idx];
    if (!opp) return at(daysAgo(days), (tx) => createSales(tx, { customer: fallbackCustomer, warehouseId: sh.id, lines }));
    return at(daysAgo(days), (tx) =>
      createSalesOrderFromOpportunity(tx, { opportunityId: opp.id, warehouseId: sh.id, userId: opp.ownerId ?? users.sales.id, items: items(lines, "price") }),
    );
  };

  // 已确认，待发货
  const soG = await at(daysAgo(12), (tx) =>
    createSales(tx, {
      customer: 7,
      warehouseId: sh.id,
      lines: [
        [6, 2],
        [1, 4],
      ],
      remark: "会议室改造项目",
    }),
  );
  await at(daysAgo(11), confirm(soG.id));
  const soH = await at(daysAgo(8), (tx) =>
    createSales(tx, {
      customer: 3,
      by: "sales2",
      warehouseId: gz.id,
      lines: [
        [0, 6],
        [3, 30],
        [9, 20],
      ],
    }),
  );
  await at(daysAgo(7), confirm(soH.id));
  const soI = await fromOpp(
    0,
    [
      [2, 30],
      [3, 30],
      [1, 6],
    ],
    1,
    4,
  );
  await at(daysAgo(3), confirm(soI.id));

  // 草稿
  await fromOpp(
    1,
    [
      [0, 15],
      [1, 15],
      [4, 5],
    ],
    4,
    1,
  );

  // 已取消
  const soK = await at(daysAgo(40), (tx) => createSales(tx, { customer: 6, by: "sales", warehouseId: sh.id, lines: [[9, 10]] }));
  await at(daysAgo(39), confirm(soK.id));
  await at(daysAgo(38), (tx) => cancelSalesOrder(tx, { salesOrderId: soK.id, userId: users.sales.id }));

  // ───────────────────────── 手工费用凭证 ─────────────────────────

  await at(daysAgo(Math.max(1, new Date().getDate() - 1)), (tx) =>
    postJournal(tx, {
      memo: "支付本月办公室租金及物业费",
      sourceType: "manual",
      userId: users.finance.id,
      lines: [
        { account: ACCOUNT.ADMIN_EXPENSE, debit: 46000, memo: "张江办公区租金 + 物业" },
        { account: ACCOUNT.BANK, credit: 46000 },
      ],
    }),
  );
  await at(daysAgo(62), (tx) =>
    postJournal(tx, {
      memo: "支付行业展会展位费及市场推广费",
      sourceType: "manual",
      userId: users.finance.id,
      lines: [
        { account: ACCOUNT.SELLING_EXPENSE, debit: 18000, memo: "展位费" },
        { account: ACCOUNT.SELLING_EXPENSE, debit: 9600, memo: "宣传物料" },
        { account: ACCOUNT.BANK, credit: 27600 },
      ],
    }),
  );
}
