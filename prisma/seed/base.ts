import bcrypt from "bcryptjs";
import type { Product, User } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_ACCOUNTS, ACCOUNT, postJournal } from "@/lib/services/ledger";
import { moveStock } from "@/lib/services/inventory";

export type SeedContext = Awaited<ReturnType<typeof seedBase>>;

function doc(...blocks: unknown[]) {
  return JSON.stringify({ type: "doc", content: blocks });
}
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const ul = (...items: string[]) => ({
  type: "bulletList",
  content: items.map((t) => ({ type: "listItem", content: [p(t)] })),
});
const todo = (...items: [string, boolean][]) => ({
  type: "taskList",
  content: items.map(([t, checked]) => ({ type: "taskItem", attrs: { checked }, content: [p(t)] })),
});

function plain(json: string): string {
  const out: string[] = [];
  const walk = (n: { text?: string; content?: unknown[] }) => {
    if (n.text) out.push(n.text);
    (n.content as { text?: string; content?: unknown[] }[] | undefined)?.forEach(walk);
  };
  walk(JSON.parse(json));
  return out.join(" ");
}

export async function seedBase() {
  // ── 角色 ──
  const roleDefs = [
    { key: "admin", name: "系统管理员", permissions: ["admin"], system: true },
    {
      key: "manager",
      name: "总经理",
      permissions: ["docs:edit", "oa:edit", "crm:view", "erp:view", "finance:view", "wms:view", "tms:view", "pms:edit"],
    },
    { key: "sales", name: "销售", permissions: ["docs:edit", "oa:view", "crm:edit", "erp:edit", "wms:view", "tms:view", "pms:view"] },
    { key: "buyer", name: "采购", permissions: ["docs:edit", "oa:view", "erp:edit", "wms:view"] },
    { key: "warehouse", name: "仓库管理员", permissions: ["docs:edit", "oa:view", "erp:view", "wms:edit", "tms:view"] },
    { key: "dispatcher", name: "运输调度", permissions: ["docs:edit", "oa:view", "wms:view", "tms:edit"] },
    { key: "driver", name: "司机", permissions: ["docs:view", "oa:view", "tms:view"] },
    { key: "pm", name: "项目经理", permissions: ["docs:edit", "oa:view", "crm:view", "pms:edit"] },
    { key: "finance", name: "财务", permissions: ["docs:edit", "oa:view", "erp:view", "finance:edit"] },
    { key: "member", name: "普通员工", permissions: ["docs:edit", "oa:view", "pms:view"], system: true },
  ];
  const roles: Record<string, { id: string }> = {};
  for (const r of roleDefs) {
    roles[r.key] = await db.role.create({
      data: { key: r.key, name: r.name, permissions: JSON.stringify(r.permissions), system: r.system ?? false },
    });
  }

  // ── 用户 ──
  const passwordHash = await bcrypt.hash("123456", 10);
  const userDefs = [
    { key: "admin", email: "admin@demo.com", name: "张伟", title: "IT 管理员", role: "admin", color: "#37352f" },
    { key: "ceo", email: "ceo@demo.com", name: "王芳", title: "总经理", role: "manager", color: "#d9730d" },
    { key: "sales", email: "sales@demo.com", name: "李娜", title: "销售经理", role: "sales", color: "#c14c8a" },
    { key: "sales2", email: "sales2@demo.com", name: "赵磊", title: "客户经理", role: "sales", color: "#9065b0" },
    { key: "buyer", email: "buyer@demo.com", name: "陈静", title: "采购主管", role: "buyer", color: "#337ea9" },
    { key: "wh", email: "wh@demo.com", name: "刘洋", title: "仓储主管", role: "warehouse", color: "#448361" },
    { key: "dispatch", email: "dispatch@demo.com", name: "杨帆", title: "调度员", role: "dispatcher", color: "#cb912f" },
    { key: "driver", email: "driver@demo.com", name: "郑强", title: "司机", role: "driver", color: "#9f6b53" },
    { key: "pm", email: "pm@demo.com", name: "周敏", title: "研发经理", role: "pm", color: "#2383e2" },
    { key: "dev", email: "dev@demo.com", name: "孙浩", title: "前端工程师", role: "member", color: "#d44c47" },
    { key: "finance", email: "finance@demo.com", name: "吴婷", title: "财务主管", role: "finance", color: "#0f7b6c" },
  ] as const;
  const users = {} as Record<(typeof userDefs)[number]["key"], User>;
  for (const u of userDefs) {
    users[u.key] = await db.user.create({
      data: { email: u.email, name: u.name, title: u.title, roleId: roles[u.role].id, avatarColor: u.color, passwordHash, phone: "138" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") },
    });
  }

  // ── 部门 ──
  const hq = await db.department.create({ data: { name: "总经办", managerId: users.ceo.id, sortOrder: 0 } });
  const deptDefs = [
    { name: "销售部", manager: "sales", members: ["sales", "sales2"] },
    { name: "采购部", manager: "buyer", members: ["buyer"] },
    { name: "仓储物流部", manager: "wh", members: ["wh", "dispatch", "driver"] },
    { name: "研发部", manager: "pm", members: ["pm", "dev"] },
    { name: "财务部", manager: "finance", members: ["finance"] },
    { name: "信息技术部", manager: "admin", members: ["admin"] },
  ] as const;
  const departments: Record<string, { id: string }> = { 总经办: hq };
  for (const [i, d] of deptDefs.entries()) {
    const dept = await db.department.create({ data: { name: d.name, parentId: hq.id, managerId: users[d.manager].id, sortOrder: i + 1 } });
    departments[d.name] = dept;
    await db.user.updateMany({ where: { id: { in: d.members.map((m) => users[m].id) } }, data: { departmentId: dept.id } });
  }
  await db.user.update({ where: { id: users.ceo.id }, data: { departmentId: hq.id } });

  // ── 会计科目 ──
  for (const a of DEFAULT_ACCOUNTS) await db.account.create({ data: { code: a.code, name: a.name, type: a.type } });

  // ── 审批流程 ──
  const flows = [
    {
      key: "leave",
      name: "请假",
      category: "人事",
      icon: "🌴",
      description: "年假、事假、病假、调休",
      formSchema: [
        { name: "leaveType", label: "请假类型", type: "select", required: true, options: ["年假", "事假", "病假", "调休", "婚假", "产假"] },
        { name: "startDate", label: "开始日期", type: "date", required: true },
        { name: "endDate", label: "结束日期", type: "date", required: true },
        { name: "days", label: "请假天数", type: "number", required: true },
        { name: "reason", label: "请假事由", type: "textarea", required: true },
      ],
      steps: [{ name: "直属主管审批", approverType: "manager" }],
    },
    {
      key: "expense",
      name: "费用报销",
      category: "财务",
      icon: "💰",
      description: "差旅、招待、办公等费用报销，通过后自动生成记账凭证",
      formSchema: [
        { name: "category", label: "费用类型", type: "select", required: true, options: ["差旅费", "业务招待费", "办公用品", "交通费", "其他"] },
        { name: "amount", label: "报销金额（元）", type: "number", required: true },
        { name: "date", label: "发生日期", type: "date", required: true },
        { name: "reason", label: "报销说明", type: "textarea", required: true },
      ],
      steps: [
        { name: "直属主管审批", approverType: "manager" },
        { name: "财务审核", approverType: "role", roleKey: "finance" },
      ],
    },
    {
      key: "trip",
      name: "出差",
      category: "人事",
      icon: "✈️",
      description: "出差申请",
      formSchema: [
        { name: "destination", label: "出差地点", type: "text", required: true },
        { name: "startDate", label: "出发日期", type: "date", required: true },
        { name: "endDate", label: "返回日期", type: "date", required: true },
        { name: "budget", label: "预算（元）", type: "number" },
        { name: "reason", label: "出差事由", type: "textarea", required: true },
      ],
      steps: [
        { name: "直属主管审批", approverType: "manager" },
        { name: "总经理审批", approverType: "role", roleKey: "manager" },
      ],
    },
    {
      key: "general",
      name: "通用审批",
      category: "通用",
      icon: "📝",
      description: "其他事项审批",
      formSchema: [
        { name: "content", label: "审批内容", type: "textarea", required: true },
        { name: "cc", label: "知会人", type: "user" },
      ],
      steps: [{ name: "直属主管审批", approverType: "manager" }],
    },
    {
      key: "purchase_order",
      name: "采购订单审批",
      category: "业务单据",
      icon: "🛒",
      description: "ERP 采购订单提交后自动发起，通过后生成入库单",
      system: true,
      formSchema: [],
      steps: [
        { name: "部门主管审批", approverType: "manager" },
        { name: "财务审核", approverType: "role", roleKey: "finance" },
      ],
    },
  ];
  for (const f of flows) {
    await db.approvalFlow.create({
      data: {
        key: f.key,
        name: f.name,
        category: f.category,
        icon: f.icon,
        description: f.description,
        system: f.system ?? false,
        formSchema: JSON.stringify(f.formSchema),
        steps: JSON.stringify(f.steps),
      },
    });
  }

  // ── 文档空间与文档 ──
  const kb = await db.space.create({ data: { name: "公司知识库", icon: "📚", description: "制度、流程与通用知识", createdById: users.admin.id, sortOrder: 0 } });
  const rd = await db.space.create({ data: { name: "产品研发", icon: "🛠️", description: "需求、设计与技术文档", createdById: users.pm.id, sortOrder: 1 } });
  const salesSpace = await db.space.create({
    data: {
      name: "销售部",
      icon: "📈",
      visibility: "PRIVATE",
      description: "销售团队内部资料",
      createdById: users.sales.id,
      sortOrder: 2,
      members: {
        create: [
          { userId: users.sales.id, role: "owner" },
          { userId: users.sales2.id, role: "editor" },
          { userId: users.ceo.id, role: "viewer" },
        ],
      },
    },
  });
  const mkDoc = async (data: { spaceId: string; parentId?: string; title: string; icon?: string; content: string; createdById: string; sortOrder?: number }) =>
    db.document.create({ data: { ...data, text: plain(data.content), updatedById: data.createdById } });

  const welcome = await mkDoc({
    spaceId: kb.id,
    title: "欢迎使用协作空间",
    icon: "👋",
    createdById: users.admin.id,
    content: doc(
      p("这是一个一体化的办公协作平台，覆盖文档、OA、CRM、ERP、WMS、TMS、PMS 七大模块。"),
      h(2, "快速上手"),
      todo(["按 Ctrl/⌘ + K 打开全局搜索", false], ["在左侧文档区新建一个页面", false], ["输入 / 唤出块菜单", false], ["在「OA · 审批中心」发起一个请假申请", false]),
      h(2, "模块说明"),
      ul("OA：审批、公告、日程", "CRM：客户、商机、跟进记录", "ERP：产品、采购、销售与财务", "WMS：仓库、库存、出入库", "TMS：运输调度与在途跟踪", "PMS：项目、任务看板与里程碑"),
    ),
  });
  const handbook = await mkDoc({
    spaceId: kb.id,
    title: "员工手册",
    icon: "📘",
    sortOrder: 1,
    createdById: users.ceo.id,
    content: doc(h(2, "工作时间"), p("标准工作时间为周一至周五 9:00 - 18:00，午休 12:00 - 13:00。"), h(2, "假期"), ul("年假：入职满一年享 5 天", "病假：需提供医院证明", "调休：需提前在 OA 提交申请")),
  });
  await mkDoc({
    spaceId: kb.id,
    parentId: handbook.id,
    title: "费用报销制度",
    icon: "💰",
    createdById: users.finance.id,
    content: doc(p("所有费用报销通过 OA「费用报销」流程提交，经直属主管审批、财务审核后，财务会在 5 个工作日内付款。"), h(3, "报销标准"), ul("市内交通：实报实销", "差旅住宿：一线城市 500 元/晚，其他城市 350 元/晚", "业务招待：需事先报备")),
  });
  await mkDoc({
    spaceId: kb.id,
    parentId: handbook.id,
    title: "请假与考勤",
    icon: "🌴",
    sortOrder: 1,
    createdById: users.ceo.id,
    content: doc(p("请假需至少提前 1 个工作日在 OA 提交申请。3 天以上假期需总经理审批。")),
  });
  const prd = await mkDoc({
    spaceId: rd.id,
    title: "2027 产品路线图",
    icon: "🗺️",
    createdById: users.pm.id,
    content: doc(h(2, "Q1"), ul("移动端审批", "文档模板中心"), h(2, "Q2"), ul("BI 报表", "开放 API")),
  });
  await mkDoc({
    spaceId: rd.id,
    title: "前端开发规范",
    icon: "🧩",
    sortOrder: 1,
    createdById: users.dev.id,
    content: doc(p("使用 TypeScript 严格模式，组件采用函数式写法。"), h(3, "提交规范"), ul("feat: 新功能", "fix: 修复问题", "docs: 文档")),
  });
  await mkDoc({
    spaceId: salesSpace.id,
    title: "销售话术与报价指南",
    icon: "💬",
    createdById: users.sales.id,
    content: doc(p("报价时先确认客户预算与采购周期，标准折扣不超过 9 折，超过需销售经理审批。")),
  });

  // ── 仓库与库位 ──
  const whSh = await db.warehouse.create({
    data: {
      code: "WH01",
      name: "上海中心仓",
      address: "上海市浦东新区张江路 88 号",
      managerId: users.wh.id,
      locations: { create: ["A-01-01", "A-01-02", "A-02-01", "B-01-01", "B-01-02", "C-01-01"].map((code) => ({ code, zone: code[0] + " 区" })) },
    },
  });
  const whGz = await db.warehouse.create({
    data: {
      code: "WH02",
      name: "广州分仓",
      address: "广州市黄埔区科学大道 166 号",
      managerId: users.wh.id,
      locations: { create: ["A-01-01", "A-01-02", "B-01-01"].map((code) => ({ code, zone: code[0] + " 区" })) },
    },
  });

  // ── 产品 ──
  const productDefs = [
    { sku: "NB-001", name: "商务笔记本电脑 14 寸", category: "电脑整机", unit: "台", price: 6999, cost: 5200, weight: 2, safetyStock: 20 },
    { sku: "MN-027", name: "27 寸 4K 显示器", category: "显示设备", unit: "台", price: 2299, cost: 1650, weight: 6.5, safetyStock: 15 },
    { sku: "KB-108", name: "机械键盘", category: "外设", unit: "个", price: 399, cost: 210, weight: 1.1, safetyStock: 50 },
    { sku: "MS-002", name: "无线鼠标", category: "外设", unit: "个", price: 129, cost: 58, weight: 0.2, safetyStock: 80 },
    { sku: "CH-300", name: "人体工学办公椅", category: "办公家具", unit: "把", price: 1599, cost: 980, weight: 18, safetyStock: 10 },
    { sku: "PR-500", name: "激光打印机", category: "办公设备", unit: "台", price: 1899, cost: 1300, weight: 9, safetyStock: 8 },
    { sku: "PJ-800", name: "会议室投影仪", category: "显示设备", unit: "台", price: 4599, cost: 3400, weight: 4, safetyStock: 5 },
    { sku: "RT-600", name: "千兆无线路由器", category: "网络设备", unit: "台", price: 499, cost: 280, weight: 0.8, safetyStock: 30 },
    { sku: "TN-12A", name: "打印机硒鼓", category: "耗材", unit: "个", price: 259, cost: 120, weight: 0.9, safetyStock: 40 },
    { sku: "PA-A4", name: "A4 复印纸（5 包/箱）", category: "耗材", unit: "箱", price: 135, cost: 92, weight: 12.5, safetyStock: 60 },
  ];
  const products: Product[] = [];
  for (const pd of productDefs) products.push(await db.product.create({ data: { ...pd, spec: null } }));

  // ── 期初：银行存款与库存 ──
  const openingStock: [number, string, number][] = [
    [0, whSh.id, 60], [1, whSh.id, 45], [2, whSh.id, 150], [3, whSh.id, 300], [4, whSh.id, 25],
    [5, whSh.id, 12], [6, whSh.id, 6], [7, whSh.id, 80], [8, whSh.id, 35], [9, whSh.id, 200],
    [0, whGz.id, 20], [1, whGz.id, 10], [3, whGz.id, 100], [9, whGz.id, 80],
  ];
  let stockValue = 0;
  await db.$transaction(async (tx) => {
    for (const [i, warehouseId, qty] of openingStock) {
      await moveStock(tx, { productId: products[i].id, warehouseId, quantity: qty, type: "ADJUST", refType: "opening", memo: "期初库存", userId: users.wh.id });
      stockValue += qty * products[i].cost;
    }
    await postJournal(tx, {
      memo: "期初余额",
      sourceType: "manual",
      userId: users.finance.id,
      lines: [
        { account: ACCOUNT.BANK, debit: 2_000_000 },
        { account: ACCOUNT.INVENTORY, debit: stockValue },
        { account: ACCOUNT.CAPITAL, credit: 2_000_000 + stockValue },
      ],
    });
  });

  // ── 供应商 ──
  const supplierDefs = [
    { code: "SUP0001", name: "联想（上海）科技有限公司", contact: "黄经理", phone: "021-55550001", email: "sales@lenovo-sh.example", address: "上海市浦东新区", rating: 5 },
    { code: "SUP0002", name: "深圳华显电子有限公司", contact: "林小姐", phone: "0755-66660002", email: "biz@huaxian.example", address: "深圳市南山区", rating: 4 },
    { code: "SUP0003", name: "杭州优选办公家具有限公司", contact: "钱先生", phone: "0571-77770003", address: "杭州市余杭区", rating: 4 },
    { code: "SUP0004", name: "广州晨光耗材供应链有限公司", contact: "何经理", phone: "020-88880004", address: "广州市白云区", rating: 3 },
  ];
  const suppliers = [];
  for (const s of supplierDefs) suppliers.push(await db.supplier.create({ data: s }));
  await db.sequence.create({ data: { key: "SUP", value: supplierDefs.length } });

  // ── 客户 ──
  const customerDefs = [
    { name: "上海星辰网络科技有限公司", industry: "互联网", level: "A", status: "CUSTOMER", source: "官网", address: "上海市徐汇区漕河泾开发区 1 号", owner: "sales", contact: ["钱总", "CTO", "13900000001"] },
    { name: "北京远航教育集团", industry: "教育", level: "A", status: "PROSPECT", source: "展会", address: "北京市海淀区中关村大街 18 号", owner: "sales", contact: ["孙主任", "行政主任", "13900000002"] },
    { name: "杭州云帆电子商务有限公司", industry: "电商", level: "B", status: "CUSTOMER", source: "老客户推荐", address: "杭州市滨江区网商路 99 号", owner: "sales2", contact: ["周经理", "采购经理", "13900000003"] },
    { name: "广州华南医疗器械有限公司", industry: "医疗", level: "B", status: "PROSPECT", source: "电话拜访", address: "广州市天河区珠江新城 66 号", owner: "sales2", contact: ["吴总监", "IT 总监", "13900000004"] },
    { name: "苏州精工制造股份有限公司", industry: "制造业", level: "A", status: "LEAD", source: "官网", address: "苏州市工业园区星湖街 328 号", owner: "sales", contact: ["郑厂长", "厂长", "13900000005"] },
    { name: "成都蜀道律师事务所", industry: "法律", level: "C", status: "LEAD", source: "广告", address: "成都市高新区天府大道 1000 号", owner: "sales2", contact: ["冯律师", "合伙人", "13900000006"] },
    { name: "南京金陵会计师事务所", industry: "专业服务", level: "C", status: "PROSPECT", source: "展会", address: "南京市鼓楼区中山北路 200 号", owner: "sales", contact: ["陈所长", "所长", "13900000007"] },
    { name: "深圳前海金融服务有限公司", industry: "金融", level: "A", status: "CUSTOMER", source: "老客户推荐", address: "深圳市南山区前海路 1 号", owner: "sales", contact: ["褚总", "运营总监", "13900000008"] },
  ] as const;
  const customers = [];
  for (const [i, c] of customerDefs.entries()) {
    customers.push(
      await db.customer.create({
        data: {
          code: `CUS${String(i + 1).padStart(4, "0")}`,
          name: c.name,
          industry: c.industry,
          level: c.level,
          status: c.status,
          source: c.source,
          address: c.address,
          phone: c.contact[2],
          ownerId: users[c.owner].id,
          contacts: { create: { name: c.contact[0], title: c.contact[1], phone: c.contact[2], isPrimary: true } },
        },
      }),
    );
  }
  await db.sequence.create({ data: { key: "CUS", value: customerDefs.length } });

  // ── 车辆 / 司机 / 线路 ──
  const vehicles = [];
  for (const v of [
    { plateNo: "沪A·12345", type: "4.2 米厢式货车", capacity: 4000 },
    { plateNo: "沪B·67890", type: "6.8 米厢式货车", capacity: 10000 },
    { plateNo: "粤A·24680", type: "4.2 米厢式货车", capacity: 4000 },
    { plateNo: "沪C·13579", type: "面包车", capacity: 1000, status: "MAINTENANCE" as const },
  ])
    vehicles.push(await db.vehicle.create({ data: v }));
  const drivers = [
    await db.driver.create({ data: { name: users.driver.name, phone: "13811110001", licenseNo: "310101198801010011", userId: users.driver.id } }),
    await db.driver.create({ data: { name: "冯军", phone: "13811110002", licenseNo: "310101198502020022" } }),
    await db.driver.create({ data: { name: "蒋涛", phone: "13811110003", licenseNo: "440101199003030033" } }),
  ];
  const routes = [
    await db.route.create({ data: { name: "上海 → 杭州", origin: "上海中心仓", destination: "杭州", distanceKm: 180, estimatedHours: 3, stops: JSON.stringify(["嘉兴服务区"]) } }),
    await db.route.create({ data: { name: "上海 → 北京", origin: "上海中心仓", destination: "北京", distanceKm: 1220, estimatedHours: 14, stops: JSON.stringify(["南京", "济南"]) } }),
    await db.route.create({ data: { name: "广州 → 深圳", origin: "广州分仓", destination: "深圳", distanceKm: 140, estimatedHours: 2.5, stops: JSON.stringify([]) } }),
  ];

  return {
    db,
    users,
    roles,
    departments,
    spaces: { kb, rd, sales: salesSpace },
    docs: { welcome, handbook, prd },
    warehouses: { sh: whSh, gz: whGz },
    products,
    suppliers,
    customers,
    vehicles,
    drivers,
    routes,
  };
}
