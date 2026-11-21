export type TagColor = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
export type StatusMeta = { label: string; color: TagColor };

function meta<T extends string>(m: Record<T, StatusMeta>) {
  return m;
}

export const APPROVAL_STATUS = meta({
  PENDING: { label: "审批中", color: "blue" },
  APPROVED: { label: "已通过", color: "green" },
  REJECTED: { label: "已驳回", color: "red" },
  WITHDRAWN: { label: "已撤回", color: "gray" },
});

export const APPROVAL_TASK_STATUS = meta({
  PENDING: { label: "待处理", color: "blue" },
  APPROVED: { label: "同意", color: "green" },
  REJECTED: { label: "驳回", color: "red" },
  SKIPPED: { label: "无需处理", color: "gray" },
});

export const CUSTOMER_STATUS = meta({
  LEAD: { label: "线索", color: "gray" },
  PROSPECT: { label: "意向客户", color: "yellow" },
  CUSTOMER: { label: "成交客户", color: "green" },
  LOST: { label: "流失", color: "red" },
});

export const CUSTOMER_LEVEL = meta({
  A: { label: "A 重要", color: "red" },
  B: { label: "B 普通", color: "blue" },
  C: { label: "C 一般", color: "gray" },
});

export const OPPORTUNITY_STAGE = meta({
  QUALIFY: { label: "初步接洽", color: "gray" },
  NEEDS: { label: "需求确认", color: "blue" },
  PROPOSAL: { label: "方案报价", color: "purple" },
  NEGOTIATION: { label: "商务谈判", color: "orange" },
  WON: { label: "赢单", color: "green" },
  LOST: { label: "输单", color: "red" },
});

export const OPPORTUNITY_STAGE_PROBABILITY: Record<keyof typeof OPPORTUNITY_STAGE, number> = {
  QUALIFY: 10,
  NEEDS: 30,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
};

export const FOLLOWUP_TYPE: Record<string, string> = {
  call: "电话",
  visit: "拜访",
  email: "邮件",
  meeting: "会议",
  wechat: "微信",
};

export const PURCHASE_STATUS = meta({
  DRAFT: { label: "草稿", color: "gray" },
  PENDING_APPROVAL: { label: "审批中", color: "blue" },
  APPROVED: { label: "待入库", color: "purple" },
  REJECTED: { label: "已驳回", color: "red" },
  PARTIAL_RECEIVED: { label: "部分入库", color: "yellow" },
  RECEIVED: { label: "已入库", color: "green" },
  CLOSED: { label: "已结清", color: "brown" },
  CANCELLED: { label: "已取消", color: "gray" },
});

export const SALES_STATUS = meta({
  DRAFT: { label: "草稿", color: "gray" },
  CONFIRMED: { label: "待发货", color: "blue" },
  SHIPPED: { label: "运输中", color: "purple" },
  DELIVERED: { label: "已签收", color: "yellow" },
  COMPLETED: { label: "已完成", color: "green" },
  CANCELLED: { label: "已取消", color: "red" },
});

export const INVOICE_TYPE = meta({
  RECEIVABLE: { label: "应收", color: "green" },
  PAYABLE: { label: "应付", color: "orange" },
});

export const INVOICE_STATUS = meta({
  UNPAID: { label: "未结清", color: "red" },
  PARTIAL: { label: "部分结清", color: "yellow" },
  PAID: { label: "已结清", color: "green" },
  VOID: { label: "已作废", color: "gray" },
});

export const ACCOUNT_TYPE = meta({
  ASSET: { label: "资产", color: "blue" },
  LIABILITY: { label: "负债", color: "orange" },
  EQUITY: { label: "所有者权益", color: "purple" },
  REVENUE: { label: "收入", color: "green" },
  EXPENSE: { label: "费用", color: "red" },
});

export const INBOUND_TYPE = meta({
  PURCHASE: { label: "采购入库", color: "blue" },
  RETURN: { label: "退货入库", color: "orange" },
  OTHER: { label: "其他入库", color: "gray" },
});

export const INBOUND_STATUS = meta({
  PENDING: { label: "待收货", color: "blue" },
  COMPLETED: { label: "已完成", color: "green" },
  CANCELLED: { label: "已取消", color: "gray" },
});

export const OUTBOUND_TYPE = meta({
  SALES: { label: "销售出库", color: "blue" },
  OTHER: { label: "其他出库", color: "gray" },
});

export const OUTBOUND_STATUS = meta({
  PENDING: { label: "待拣货", color: "blue" },
  PICKING: { label: "拣货中", color: "yellow" },
  SHIPPED: { label: "已发货", color: "green" },
  CANCELLED: { label: "已取消", color: "gray" },
});

export const MOVEMENT_TYPE = meta({
  IN: { label: "入库", color: "green" },
  OUT: { label: "出库", color: "red" },
  TRANSFER_IN: { label: "调入", color: "blue" },
  TRANSFER_OUT: { label: "调出", color: "orange" },
  ADJUST: { label: "盘点调整", color: "purple" },
});

export const VEHICLE_STATUS = meta({
  AVAILABLE: { label: "空闲", color: "green" },
  IN_USE: { label: "运输中", color: "blue" },
  MAINTENANCE: { label: "维修保养", color: "orange" },
});

export const DRIVER_STATUS = meta({
  AVAILABLE: { label: "空闲", color: "green" },
  ON_DUTY: { label: "出车中", color: "blue" },
  OFF: { label: "休息", color: "gray" },
});

export const TRANSPORT_STATUS = meta({
  PENDING: { label: "待调度", color: "gray" },
  ASSIGNED: { label: "已调度", color: "blue" },
  IN_TRANSIT: { label: "运输中", color: "purple" },
  DELIVERED: { label: "已签收", color: "green" },
  CANCELLED: { label: "已取消", color: "red" },
});

export const PROJECT_STATUS = meta({
  PLANNING: { label: "规划中", color: "gray" },
  ACTIVE: { label: "进行中", color: "blue" },
  ON_HOLD: { label: "已暂停", color: "orange" },
  COMPLETED: { label: "已完成", color: "green" },
  CANCELLED: { label: "已取消", color: "red" },
});

export const MILESTONE_STATUS = meta({
  OPEN: { label: "进行中", color: "blue" },
  DONE: { label: "已达成", color: "green" },
});

export const TASK_STATUS = meta({
  TODO: { label: "待办", color: "gray" },
  IN_PROGRESS: { label: "进行中", color: "blue" },
  REVIEW: { label: "待验收", color: "purple" },
  DONE: { label: "已完成", color: "green" },
});

export const TASK_PRIORITY = meta({
  LOW: { label: "低", color: "gray" },
  MEDIUM: { label: "中", color: "blue" },
  HIGH: { label: "高", color: "orange" },
  URGENT: { label: "紧急", color: "red" },
});

export const NOTIFICATION_TYPE: Record<string, string> = {
  mention: "提及",
  comment: "评论",
  approval: "审批",
  task: "任务",
  system: "系统",
  announcement: "公告",
  order: "业务单据",
  event: "日程",
};
