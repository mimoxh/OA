// 推送派发的数据结构：服务端计算、各驱动共用，保证换驱动后提醒结果一致

/** 与 Android 通知渠道一一对应（mobile/android 的 Notifier.java） */
export type PushChannel = "dm" | "group" | "mention" | "system";

export type PushNotification = {
  userId: string;
  conversationId: string;
  messageId: string;
  seq: number;
  channel: PushChannel;
  title: string;
  body: string;
  /** 点击后打开的站内路径 */
  path: string;
  mentioned: boolean;
  /** 消息创建时间（服务端时钟，ISO），客户端用作补拉游标 */
  sentAt: string;
  /** 补拉汇总时同一会话的未读条数；实时推送为 1 */
  count: number;
};

export type PushItem =
  | { kind: "notify"; notification: PushNotification }
  | { kind: "clear"; userId: string; conversationId: string; seq: number };

/** 推送驱动：realtime 已实现；jpush / getui 预留（见 drivers/）。send 在事务提交后调用，不得抛出 */
export interface PushDriver {
  readonly name: string;
  send(items: PushItem[]): Promise<void>;
}
