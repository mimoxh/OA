import { publish, type PublishItem } from "@/lib/realtime/publish";
import type { PushDriver, PushItem } from "../types";

/**
 * realtime 驱动：经现有实时通道（/rt）投递 push.notify / push.clear 事件。
 * 实时服务只把 push.* 事件发给手机后台连接（?client=bg）和 App 内 WebView（?client=app），见 src/lib/push/realtime-filter.ts。
 */
export function toRealtimeEvents(items: PushItem[]): PublishItem[] {
  return items.map((item) => {
    if (item.kind === "clear") {
      return { userIds: [item.userId], event: { type: "push.clear", conversationId: item.conversationId, seq: item.seq } };
    }
    const { userId, ...notification } = item.notification;
    return { userIds: [userId], event: { type: "push.notify", notification } };
  });
}

export const realtimeDriver: PushDriver = {
  name: "realtime",
  async send(items) {
    await publish(toRealtimeEvents(items));
  },
};
