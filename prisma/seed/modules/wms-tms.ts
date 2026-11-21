import type { SeedContext } from "../base";
import type { Tx } from "@/lib/db";
import { nextNo } from "@/lib/sequence";
import { adjustStock, transferStock } from "@/lib/services/inventory";
import {
  addTransportEvent,
  assignTransport,
  calcTotal,
  confirmSalesOrder,
  deliverTransport,
  departTransport,
  onPurchaseApproved,
  receiveInbound,
  shipOutbound,
  startPicking,
} from "@/lib/services/flows";

const HOUR = 3600_000;

/**
 * WMS / TMS 示例数据（最后执行）。优先使用 ERP 种子产生的入库单、出库单、运输单；
 * 若上游单据不足，则通过真实业务服务自行创建，保证各状态都有数据。
 * 每个步骤独立事务并容错，单步失败只跳过该步。
 */
export async function seedWmsTms(ctx: SeedContext) {
  const { db, users, warehouses, products, suppliers, customers } = ctx;
  const sh = warehouses.sh;
  const gz = warehouses.gz;

  async function step(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      console.warn(`  ! WMS/TMS 种子步骤「${name}」已跳过：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const available = async (tx: Tx, productId: string, warehouseId: string) => {
    const inv = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
    return inv ? inv.quantity - inv.reservedQty : 0;
  };

  const locations = await db.location.findMany({ orderBy: { code: "asc" } });
  const locOf = (warehouseId: string) => locations.filter((l) => l.warehouseId === warehouseId);

  // ── 库存默认库位 ──
  await step("默认库位", async () => {
    for (const wh of [sh, gz]) {
      const locs = locOf(wh.id);
      if (!locs.length) continue;
      const invs = await db.inventory.findMany({ where: { warehouseId: wh.id, locationId: null }, orderBy: { productId: "asc" } });
      for (const [i, inv] of invs.entries()) {
        await db.inventory.update({ where: { id: inv.id }, data: { locationId: locs[i % locs.length].id } });
      }
    }
  });

  // ── 采购入库：确保至少 3 张待收货的采购入库单 ──
  const poPlans: { supplier: number; warehouseId: string; items: [number, number, number][]; remark: string }[] = [
    { supplier: 0, warehouseId: sh.id, items: [[0, 10, 5100], [1, 8, 1620]], remark: "Q4 笔记本与显示器补货" },
    { supplier: 2, warehouseId: sh.id, items: [[4, 12, 960], [2, 30, 205]], remark: "办公椅与键盘补货" },
    { supplier: 3, warehouseId: gz.id, items: [[8, 40, 115], [9, 50, 90]], remark: "广州分仓耗材备货" },
  ];
  let pendingIn = await db.inboundOrder.findMany({
    where: { status: "PENDING", type: "PURCHASE" },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
  for (const plan of poPlans) {
    if (pendingIn.length >= 3) break;
    await step("创建采购单并审批", () =>
      db.$transaction(async (tx) => {
        const items = plan.items.map(([idx, quantity, price]) => ({ productId: products[idx].id, quantity, price }));
        const po = await tx.purchaseOrder.create({
          data: {
            no: await nextNo(tx, "PO"),
            supplierId: suppliers[plan.supplier].id,
            warehouseId: plan.warehouseId,
            status: "PENDING_APPROVAL",
            totalAmount: calcTotal(items),
            expectedDate: new Date(Date.now() + 3 * 24 * HOUR),
            remark: plan.remark,
            createdById: users.buyer.id,
            items: { create: items },
          },
        });
        await onPurchaseApproved(tx, po.id, users.ceo.id);
      }),
    );
    pendingIn = await db.inboundOrder.findMany({ where: { status: "PENDING", type: "PURCHASE" }, include: { items: true }, orderBy: { createdAt: "asc" } });
  }

  // 第一张全部收货，第二张部分收货（自动生成剩余入库单），其余保持待收货
  if (pendingIn[0]) {
    const inbound = pendingIn[0];
    await step("采购入库全部收货", () =>
      db.$transaction(async (tx) => {
        const locs = locOf(inbound.warehouseId);
        await receiveInbound(tx, {
          inboundId: inbound.id,
          userId: users.wh.id,
          items: inbound.items.map((it, i) => ({ id: it.id, receivedQty: it.expectedQty, locationId: locs[i % Math.max(1, locs.length)]?.id ?? null })),
        });
      }),
    );
  }
  if (pendingIn[1]) {
    const inbound = pendingIn[1];
    await step("采购入库部分收货", () =>
      db.$transaction(async (tx) => {
        const locs = locOf(inbound.warehouseId);
        await receiveInbound(tx, {
          inboundId: inbound.id,
          userId: users.wh.id,
          items: inbound.items.map((it, i) => ({
            id: it.id,
            receivedQty: i === 0 ? Math.max(1, Math.floor(it.expectedQty / 2)) : it.expectedQty,
            locationId: locs[(i + 2) % Math.max(1, locs.length)]?.id ?? null,
          })),
        });
      }),
    );
  }

  // ── 手工入库（其他入库，已完成）+ 退货入库（待收货） ──
  await step("手工入库", () =>
    db.$transaction(async (tx) => {
      const inbound = await tx.inboundOrder.create({
        data: {
          no: await nextNo(tx, "IN"),
          warehouseId: gz.id,
          type: "OTHER",
          remark: "展会样品归还入库",
          createdById: users.wh.id,
          items: {
            create: [
              { productId: products[2].id, expectedQty: 12 },
              { productId: products[7].id, expectedQty: 6 },
            ],
          },
        },
        include: { items: true },
      });
      const locs = locOf(gz.id);
      await receiveInbound(tx, {
        inboundId: inbound.id,
        userId: users.wh.id,
        items: inbound.items.map((it, i) => ({ id: it.id, receivedQty: it.expectedQty, locationId: locs[i % Math.max(1, locs.length)]?.id ?? null })),
      });
    }),
  );
  await step("退货入库（待收货）", () =>
    db.$transaction(async (tx) => {
      await tx.inboundOrder.create({
        data: {
          no: await nextNo(tx, "IN"),
          warehouseId: sh.id,
          type: "RETURN",
          expectedDate: new Date(Date.now() + 24 * HOUR),
          remark: `${customers[2].name} 退回 2 台显示器（屏幕坏点）`,
          createdById: users.wh.id,
          items: { create: [{ productId: products[1].id, expectedQty: 2 }] },
        },
      });
    }),
  );

  // ── 调拨与盘点 ──
  await step("库存调拨", () =>
    db.$transaction(async (tx) => {
      const qty = Math.min(15, await available(tx, products[2].id, sh.id));
      if (qty <= 0) throw new Error("上海中心仓机械键盘可用库存不足");
      await transferStock(tx, { productId: products[2].id, fromWarehouseId: sh.id, toWarehouseId: gz.id, quantity: qty, userId: users.wh.id, memo: "广州分仓补货" });
    }),
  );
  await step("盘点调整（盘亏）", () =>
    db.$transaction(async (tx) => {
      const inv = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId: products[6].id, warehouseId: sh.id } } });
      if (!inv || inv.quantity < 2) throw new Error("投影仪库存不足以演示盘亏");
      await adjustStock(tx, {
        productId: products[6].id,
        warehouseId: sh.id,
        newQuantity: Math.max(inv.reservedQty, inv.quantity - 2),
        userId: users.wh.id,
        memo: "盘点：月度盘点发现 2 台外包装破损，返厂维修",
      });
    }),
  );
  await step("盘点调整（盘盈）", () =>
    db.$transaction(async (tx) => {
      const inv = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId: products[3].id, warehouseId: gz.id } } });
      await adjustStock(tx, { productId: products[3].id, warehouseId: gz.id, newQuantity: (inv?.quantity ?? 0) + 3, userId: users.wh.id, memo: "盘点：月度盘点盘盈 3 个" });
    }),
  );

  // ── 手工出库（其他出库，已发货） ──
  await step("手工出库", () =>
    db.$transaction(async (tx) => {
      const lines = [
        { productId: products[3].id, quantity: 5 },
        { productId: products[8].id, quantity: 2 },
      ];
      for (const l of lines) {
        if ((await available(tx, l.productId, sh.id)) < l.quantity) throw new Error("可用库存不足");
      }
      const ob = await tx.outboundOrder.create({
        data: { no: await nextNo(tx, "OUT"), warehouseId: sh.id, type: "OTHER", remark: "行政部领用办公耗材", createdById: users.wh.id, items: { create: lines } },
      });
      await shipOutbound(tx, { outboundId: ob.id, userId: users.wh.id });
    }),
  );

  // ── 销售出库：确保至少 4 张待处理的销售出库单 ──
  const soPlans: { customer: number; items: [number, number][] }[] = [
    { customer: 0, items: [[2, 5], [3, 10]] },
    { customer: 2, items: [[0, 2], [1, 2]] },
    { customer: 7, items: [[7, 4], [8, 6]] },
    { customer: 3, items: [[9, 8], [3, 6]] },
    { customer: 4, items: [[5, 1], [2, 3]] },
  ];
  const pendingSalesOut = () =>
    db.outboundOrder.findMany({ where: { status: "PENDING", type: "SALES" }, orderBy: { createdAt: "asc" } });
  let pendingOut = await pendingSalesOut();
  for (const plan of soPlans) {
    if (pendingOut.length >= 4) break;
    await step("创建并确认销售订单", () =>
      db.$transaction(async (tx) => {
        for (const [idx, qty] of plan.items) {
          if ((await available(tx, products[idx].id, sh.id)) < qty) throw new Error(`「${products[idx].name}」可用库存不足`);
        }
        const customer = customers[plan.customer];
        const contact = await tx.contact.findFirst({ where: { customerId: customer.id, isPrimary: true } });
        const items = plan.items.map(([idx, quantity]) => ({ productId: products[idx].id, quantity, price: products[idx].price }));
        const so = await tx.salesOrder.create({
          data: {
            no: await nextNo(tx, "SO"),
            customerId: customer.id,
            warehouseId: sh.id,
            totalAmount: calcTotal(items),
            shippingAddress: customer.address,
            consignee: contact?.name ?? customer.name,
            consigneePhone: contact?.phone ?? customer.phone,
            remark: "演示订单",
            createdById: customer.ownerId ?? users.sales.id,
            items: { create: items },
          },
        });
        await confirmSalesOrder(tx, { salesOrderId: so.id, userId: users.sales.id });
      }),
    );
    pendingOut = await pendingSalesOut();
  }
  // [0] 保持待拣货，[1] 开始拣货，[2][3] 发货生成运输单
  if (pendingOut[1]) {
    const ob = pendingOut[1];
    await step("开始拣货", () => db.$transaction((tx) => startPicking(tx, { outboundId: ob.id, userId: users.wh.id })));
  }
  for (const ob of pendingOut.slice(2, 4)) {
    await step("销售出库发货", () => db.$transaction((tx) => shipOutbound(tx, { outboundId: ob.id, userId: users.wh.id })));
  }

  // ── 运输：确保至少 4 张待调度运输单，分别推进到 已签收 / 运输中 / 已调度 / 待调度 ──
  const pendingTransports = () => db.transportOrder.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  let pendingTo = await pendingTransports();
  const manualPlans = [
    { origin: sh.address ?? sh.name, destination: "杭州市滨江区网商路 99 号", consignee: "周经理", consigneePhone: "13900000003", weight: 86, customerId: customers[2].id, remark: "展会物料配送" },
    { origin: gz.address ?? gz.name, destination: "深圳市南山区前海路 1 号", consignee: "褚总", consigneePhone: "13900000008", weight: 120, customerId: customers[7].id, remark: "样机寄送" },
    { origin: sh.address ?? sh.name, destination: "苏州市工业园区星湖街 328 号", consignee: "郑厂长", consigneePhone: "13900000005", weight: 45, customerId: customers[4].id, remark: "试用设备送货" },
    { origin: sh.address ?? sh.name, destination: "南京市鼓楼区中山北路 200 号", consignee: "陈所长", consigneePhone: "13900000007", weight: 30, customerId: customers[6].id, remark: "资料与耗材配送" },
  ];
  for (const plan of manualPlans) {
    if (pendingTo.length >= 5) break;
    await step("手工运输单", () =>
      db.$transaction(async (tx) => {
        await tx.transportOrder.create({
          data: {
            no: await nextNo(tx, "TO"),
            ...plan,
            events: { create: { status: "PENDING", note: "手工创建运输单，等待调度", userId: users.dispatch.id } },
          },
        });
      }),
    );
    pendingTo = await pendingTransports();
  }

  await step("补充线路", async () => {
    const extra = [
      { name: "上海 → 广州", origin: "上海中心仓", destination: "广州", distanceKm: 1430, estimatedHours: 17, stops: ["杭州", "南昌", "韶关"] },
      { name: "上海 → 深圳", origin: "上海中心仓", destination: "深圳", distanceKm: 1480, estimatedHours: 18, stops: ["杭州", "福州", "厦门"] },
      { name: "上海 → 南京", origin: "上海中心仓", destination: "南京", distanceKm: 300, estimatedHours: 4, stops: ["苏州", "无锡"] },
      { name: "上海 → 苏州", origin: "上海中心仓", destination: "苏州", distanceKm: 100, estimatedHours: 1.5, stops: [] },
    ];
    for (const r of extra) {
      if (await db.route.findFirst({ where: { name: r.name } })) continue;
      await db.route.create({ data: { ...r, stops: JSON.stringify(r.stops) } });
    }
  });
  const drivers = await db.driver.findMany({ orderBy: { createdAt: "asc" } });
  const routes = await db.route.findMany({ orderBy: { createdAt: "asc" } });
  const used = new Set<string>();
  const pickVehicle = async (weight: number, prefer?: string) => {
    const fresh = await db.vehicle.findMany({ where: { status: "AVAILABLE" } });
    const ok = fresh.filter((v) => v.capacity >= weight && !used.has(v.id));
    const v = ok.find((x) => x.plateNo === prefer) ?? ok.sort((a, b) => a.capacity - b.capacity)[0];
    if (!v) throw new Error("没有可用车辆");
    used.add(v.id);
    return v;
  };
  const driverByName = (name: string) => drivers.find((d) => d.name === name) ?? drivers.find((d) => d.status !== "OFF");
  const demoDriver = drivers.find((d) => d.userId === users.driver.id) ?? drivers[0];
  // 线路起点形如「上海中心仓」，按前两个字（城市）与运输单起点匹配
  const routeFor = (order: { origin: string; destination: string }) =>
    routes.find((r) => order.origin.includes(r.origin.slice(0, 2)) && order.destination.includes(r.destination)) ?? null;

  const backdate = async (orderId: string, hoursAgo: number[]) => {
    const events = await db.transportEvent.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
    for (const [i, e] of events.entries()) {
      const h = hoursAgo[Math.min(i, hoursAgo.length - 1)];
      await db.transportEvent.update({ where: { id: e.id }, data: { createdAt: new Date(Date.now() - h * HOUR) } });
    }
  };

  const [toDelivered, toTransit, toAssigned] = pendingTo;
  if (toDelivered) {
    await step("运输单签收", async () => {
      const vehicle = await pickVehicle(toDelivered.weight, "沪B·67890");
      const driver = driverByName("冯军");
      if (!driver) throw new Error("没有可用司机");
      const route = routeFor(toDelivered);
      await db.$transaction(async (tx) => {
        await assignTransport(tx, {
          orderId: toDelivered.id,
          vehicleId: vehicle.id,
          driverId: driver.id,
          routeId: route?.id ?? null,
          plannedAt: new Date(Date.now() - 26 * HOUR),
          freightCost: 680,
          userId: users.dispatch.id,
        });
        await departTransport(tx, { orderId: toDelivered.id, userId: driver.userId ?? users.dispatch.id });
        await addTransportEvent(tx, { orderId: toDelivered.id, userId: users.dispatch.id, location: route?.name.includes("杭州") ? "嘉兴服务区" : "途中服务区", note: "途中休息补给，路况良好" });
        await deliverTransport(tx, { orderId: toDelivered.id, userId: users.dispatch.id, note: "收货人本人签收，货物完好" });
      });
      used.delete(vehicle.id);
      await backdate(toDelivered.id, [30, 27, 25, 23.5, 21]);
      await db.transportOrder.update({
        where: { id: toDelivered.id },
        data: { departedAt: new Date(Date.now() - 25 * HOUR), deliveredAt: new Date(Date.now() - 21 * HOUR) },
      });
    });
  }
  if (toTransit) {
    await step("运输单在途", async () => {
      const vehicle = await pickVehicle(toTransit.weight, "沪A·12345");
      const route = routeFor(toTransit);
      const stops: string[] = route ? JSON.parse(route.stops) : [];
      await db.$transaction(async (tx) => {
        await assignTransport(tx, {
          orderId: toTransit.id,
          vehicleId: vehicle.id,
          driverId: demoDriver.id,
          routeId: route?.id ?? null,
          plannedAt: new Date(Date.now() - 5 * HOUR),
          freightCost: route ? Math.round(route.distanceKm * 4) : 800,
          userId: users.dispatch.id,
        });
        await departTransport(tx, { orderId: toTransit.id, userId: users.driver.id });
        await addTransportEvent(tx, { orderId: toTransit.id, userId: users.driver.id, location: stops[0] ?? "G60 沪昆高速松江段", note: "已驶出城区，路况畅通" });
        await addTransportEvent(tx, { orderId: toTransit.id, userId: users.driver.id, location: stops[1] ?? `${stops[0] ?? "途中"}服务区`, note: "司机休息 20 分钟后继续出发" });
      });
      await backdate(toTransit.id, [7, 6, 4.5, 2.5, 0.6]);
      await db.transportOrder.update({ where: { id: toTransit.id }, data: { departedAt: new Date(Date.now() - 4.5 * HOUR) } });
    });
  }
  if (toAssigned) {
    await step("运输单调度", async () => {
      const vehicle = await pickVehicle(toAssigned.weight, "粤A·24680");
      const driver = driverByName("蒋涛");
      if (!driver) throw new Error("没有可用司机");
      const route = routeFor(toAssigned);
      const planned = new Date(Date.now() + 18 * HOUR);
      planned.setMinutes(0, 0, 0);
      await db.$transaction((tx) =>
        assignTransport(tx, {
          orderId: toAssigned.id,
          vehicleId: vehicle.id,
          driverId: driver.id,
          routeId: route?.id ?? null,
          plannedAt: planned,
          freightCost: route ? Math.round(route.distanceKm * 4) : 450,
          userId: users.dispatch.id,
        }),
      );
      await backdate(toAssigned.id, [3, 1]);
    });
  }
}
