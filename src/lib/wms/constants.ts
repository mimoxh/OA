import type { StatusMeta } from "@/lib/labels";

export const LOCATION_TYPE: Record<string, StatusMeta> = {
  storage: { label: "存储区", color: "blue" },
  picking: { label: "拣货区", color: "green" },
  staging: { label: "暂存区", color: "orange" },
};

export const LOCATION_TYPE_OPTIONS = Object.entries(LOCATION_TYPE).map(([value, m]) => ({ value, label: m.label }));

export const MOVEMENT_REF_LABEL: Record<string, string> = {
  inbound: "入库单",
  outbound: "出库单",
  transfer: "库存调拨",
  adjust: "盘点调整",
  opening: "期初库存",
};

/** 根据流水的关联单据类型返回详情链接 */
export function movementRefHref(refType: string | null, refId: string | null) {
  if (!refId) return null;
  if (refType === "inbound") return `/wms/inbound/${refId}`;
  if (refType === "outbound") return `/wms/outbound/${refId}`;
  return null;
}
