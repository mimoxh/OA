export type MemberOption = {
  id: string;
  name: string;
  avatarColor: string;
  title: string | null;
  department: string | null;
  isBot?: boolean;
};

export const PALETTE = [
  "#2383e2",
  "#0f7b6c",
  "#448361",
  "#cb912f",
  "#d9730d",
  "#d44c47",
  "#c14c8a",
  "#9065b0",
  "#337ea9",
  "#9f6b53",
  "#37352f",
  "#6b7280",
] as const;

export const ANNOUNCEMENT_CATEGORIES = ["通知", "制度", "活动", "人事", "喜报", "其他"] as const;

export const FLOW_CATEGORIES = ["人事", "财务", "行政", "通用", "业务单据"] as const;

export const EVENT_STATUS: Record<string, { label: string; color: "gray" | "green" | "red" | "blue" }> = {
  pending: { label: "待回复", color: "gray" },
  accepted: { label: "已接受", color: "green" },
  declined: { label: "已拒绝", color: "red" },
};

export const CATEGORY_COLOR: Record<string, "blue" | "purple" | "orange" | "green" | "pink" | "gray"> = {
  通知: "blue",
  制度: "purple",
  活动: "orange",
  人事: "green",
  喜报: "pink",
};
