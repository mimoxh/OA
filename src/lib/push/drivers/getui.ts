import type { PushDriver } from "../types";

/** 个推驱动（预留，未实现）：与 jpush 相同，需要设备登记（clientId）与个推 REST API v2 /push/single/cid。 */
let warned = false;
export const getuiDriver: PushDriver = {
  name: "getui",
  async send() {
    if (!warned) console.warn("[push] getui 驱动尚未实现，已跳过");
    warned = true;
  },
};
