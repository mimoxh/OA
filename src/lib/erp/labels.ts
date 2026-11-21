export const ERP_AUDIT_ACTION: Record<string, string> = {
  created: "创建了订单",
  created_from_opportunity: "由商机转化创建了订单",
  updated: "修改了订单",
  submitted: "提交了审批",
  resubmitted: "修改后重新提交了审批",
  approved: "审批通过，已生成入库单",
  withdrawn: "撤回了审批",
  cancelled: "取消了订单",
  confirmed: "确认了订单，已预占库存并生成出库单",
};

export const SALES_STEPS = [
  { key: "DRAFT", label: "草稿" },
  { key: "CONFIRMED", label: "待发货" },
  { key: "SHIPPED", label: "运输中" },
  { key: "DELIVERED", label: "已签收" },
  { key: "COMPLETED", label: "已完成" },
] as const;

export const PURCHASE_STEPS = [
  { key: "DRAFT", label: "草稿" },
  { key: "PENDING_APPROVAL", label: "审批中" },
  { key: "APPROVED", label: "待入库" },
  { key: "RECEIVED", label: "已入库" },
  { key: "CLOSED", label: "已结清" },
] as const;

/** 库存流水关联单据链接 */
export function movementRefHref(refType: string | null, refId: string | null) {
  if (!refId) return null;
  if (refType === "inbound") return `/wms/inbound/${refId}`;
  if (refType === "outbound") return `/wms/outbound/${refId}`;
  return null;
}
