import { AsyncLocalStorage } from "node:async_hooks";
import { deliverPush, planPush } from "@/lib/push/drivers";
import type { PushItem } from "@/lib/push/types";
import { publish, type PublishItem } from "./publish";

export type { PublishItem };

type BufferStore = { items: PublishItem[]; push: PushItem[] };

const storage = new AsyncLocalStorage<BufferStore>();

/**
 * 把「要推送给在线客户端的实时事件」放进当前请求的缓冲区。
 * 在事务/业务代码内调用；事件在 runAction 包裹的事务提交后才真正下发。
 * 不在缓冲区上下文中（如种子脚本、离线任务）调用时静默丢弃。
 */
export function queueEvent(userIds: (string | null | undefined)[], event: Record<string, unknown>) {
  const store = storage.getStore();
  if (!store) return;
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  store.items.push({ userIds: ids, event });
}

/** 与 queueEvent 相同的时机与丢弃规则，提交后交给推送驱动（src/lib/push/drivers） */
export function queuePush(item: PushItem) {
  storage.getStore()?.push.push(item);
}

export function hasRealtimeBuffer(): boolean {
  return !!storage.getStore();
}

/** 在独立的实时事件缓冲区中运行 fn；返回结果与 flush（提交后才可调用） */
export async function withRealtimeBuffer<T>(fn: () => Promise<T>): Promise<{ result: T; flush: () => Promise<void> }> {
  const store: BufferStore = { items: [], push: [] };
  const result = await storage.run(store, fn);
  const { items, push } = store;
  return {
    result,
    flush: async () => {
      const { events, others } = planPush(push);
      await Promise.all([publish(events.length ? [...items, ...events] : items), deliverPush(push, others)]);
    },
  };
}
