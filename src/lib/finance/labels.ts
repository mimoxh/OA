import type { TagColor } from "@/lib/labels";

export const VOUCHER_SOURCE: Record<string, { label: string; color: TagColor }> = {
  manual: { label: "手工凭证", color: "gray" },
  purchase_inbound: { label: "采购入库", color: "blue" },
  sales_shipment: { label: "销售成本结转", color: "purple" },
  sales_delivery: { label: "销售收入确认", color: "green" },
  payment: { label: "收付款", color: "yellow" },
  expense: { label: "费用报销", color: "orange" },
  freight: { label: "运费", color: "brown" },
  invoice_void: { label: "发票作废冲销", color: "red" },
};

export function sourceMeta(type: string) {
  return VOUCHER_SOURCE[type] ?? { label: type, color: "gray" as TagColor };
}

/** 凭证来源单据链接；payment 需要先查到发票，由调用方处理 */
export function sourceHref(type: string, id: string | null): string | null {
  if (!id) return null;
  switch (type) {
    case "purchase_inbound":
      return `/wms/inbound/${id}`;
    case "sales_shipment":
      return `/wms/outbound/${id}`;
    case "sales_delivery":
      return `/erp/sales/${id}`;
    case "expense":
      return `/oa/approvals/${id}`;
    case "freight":
      return `/tms/orders/${id}`;
    case "invoice_void":
      return `/finance/invoices/${id}`;
    default:
      return null;
  }
}

export const PAYMENT_METHODS = ["银行转账", "现金", "支票", "银行承兑汇票", "支付宝", "微信支付"];

/** 借方余额类科目（资产、费用），其余为贷方余额类 */
export function isDebitNormal(type: string) {
  return type === "ASSET" || type === "EXPENSE";
}
