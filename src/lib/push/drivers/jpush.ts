import type { PushDriver } from "../types";

/**
 * 极光推送驱动（预留，未实现）。接入时需要：
 * - 设备登记：App 上报 registrationId（新增 PushDevice 表与 POST/DELETE /api/push/devices）；
 * - 调用 JPush REST API v3 /push，按 userId 查设备后发送 notification（title/body/extras.path/channel）；
 * - 厂商通道参数（小米/华为/OPPO/vivo 的 channel_id 与 importance）按 PushChannel 映射。
 * 规则与摘要已由 rules.ts 算好，驱动只负责投递。
 */
let warned = false;
export const jpushDriver: PushDriver = {
  name: "jpush",
  async send() {
    if (!warned) console.warn("[push] jpush 驱动尚未实现，已跳过");
    warned = true;
  },
};
