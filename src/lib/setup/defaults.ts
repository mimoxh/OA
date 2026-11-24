import { DEFAULT_ACCOUNTS } from "@/lib/services/ledger";
import type { DbClient } from "@/lib/db";

export type RoleTemplate = { key: string; name: string; permissions: string[]; system?: boolean };

export type ApprovalFlowTemplate = {
  key: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  system?: boolean;
  formSchema: { name: string; label: string; type: string; required?: boolean; options?: string[] }[];
  steps: { name: string; approverType: string; roleKey?: string }[];
};

/** 内置角色：admin / member 为系统角色，其余为可修改的岗位模板（审批流程按 roleKey 引用） */
export const ROLE_TEMPLATES: RoleTemplate[] = [
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

/** 内置审批流程；purchase_order 由 ERP 采购单自动发起 */
export const APPROVAL_FLOW_TEMPLATES: ApprovalFlowTemplate[] = [
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

/**
 * 新工作空间必需的基础数据：角色、会计科目、审批流程。
 * 按唯一键跳过已存在的记录，可重复执行。
 */
export async function ensureWorkspaceDefaults(client: DbClient) {
  for (const r of ROLE_TEMPLATES) {
    await client.role.upsert({
      where: { key: r.key },
      update: {},
      create: { key: r.key, name: r.name, permissions: JSON.stringify(r.permissions), system: r.system ?? false },
    });
  }
  for (const a of DEFAULT_ACCOUNTS) {
    await client.account.upsert({ where: { code: a.code }, update: {}, create: { code: a.code, name: a.name, type: a.type } });
  }
  for (const f of APPROVAL_FLOW_TEMPLATES) {
    await client.approvalFlow.upsert({
      where: { key: f.key },
      update: {},
      create: {
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
}
