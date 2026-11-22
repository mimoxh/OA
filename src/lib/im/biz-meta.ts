// 业务群与业务引用展示元数据：纯常量，可在客户端安全引用

import type { BizType, RefType } from "./types";

export const BIZ_META: Record<BizType, { tag: string; groupLabel: string; detailLabel: string; href: (id: string) => string }> = {
  project: { tag: "项目", groupLabel: "项目群", detailLabel: "查看项目", href: (id) => `/pms/projects/${id}` },
  customer: { tag: "客户", groupLabel: "客户群", detailLabel: "查看客户", href: (id) => `/crm/customers/${id}` },
  opportunity: { tag: "商机", groupLabel: "商机群", detailLabel: "查看商机", href: (id) => `/crm/opportunities/${id}` },
  event: { tag: "会议", groupLabel: "会议群", detailLabel: "查看日程", href: (id) => `/oa/calendar?event=${id}` },
};

export const REF_LABEL: Record<RefType, string> = {
  document: "云文档",
  approval: "审批单",
  customer: "客户",
  opportunity: "商机",
  sales: "销售订单",
  purchase: "采购订单",
  project: "项目",
  transport: "运输单",
  event: "日程",
};

export function isBizType(v: string | null | undefined): v is BizType {
  return v === "project" || v === "customer" || v === "opportunity" || v === "event";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
