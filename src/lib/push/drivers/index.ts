import type { PublishItem } from "@/lib/realtime/publish";
import type { PushDriver, PushItem } from "../types";
import { getuiDriver } from "./getui";
import { jpushDriver } from "./jpush";
import { realtimeDriver, toRealtimeEvents } from "./realtime";

const KNOWN: Record<string, PushDriver> = {
  realtime: realtimeDriver,
  jpush: jpushDriver,
  getui: getuiDriver,
};

let cached: { key: string; drivers: PushDriver[] } | null = null;

/** PUSH_DRIVERS=realtime（默认），可逗号分隔启用多个；未知名称忽略 */
export function activePushDrivers(): PushDriver[] {
  const key = (process.env.PUSH_DRIVERS ?? "realtime").trim() || "realtime";
  if (cached?.key === key) return cached.drivers;
  const names = [...new Set(key.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const drivers = names.map((n) => KNOWN[n]).filter((d): d is PushDriver => !!d);
  for (const n of names) if (!KNOWN[n]) console.warn(`[push] 未知推送驱动 ${n}，已忽略`);
  cached = { key, drivers };
  return drivers;
}

/**
 * 启用了 realtime 驱动时，把它的事件并进同一批实时事件一起投递（一次 /publish 或同一轮 Redis 发布），
 * 其余驱动另行调用 deliverPush。
 */
export function planPush(items: PushItem[], drivers: PushDriver[] = activePushDrivers()): { events: PublishItem[]; others: PushDriver[] } {
  const inline = drivers.includes(realtimeDriver);
  return {
    events: inline && items.length ? toRealtimeEvents(items) : [],
    others: inline ? drivers.filter((d) => d !== realtimeDriver) : drivers,
  };
}

/** 事务提交后调用；各驱动互不影响，永不抛出 */
export async function deliverPush(items: PushItem[], drivers: PushDriver[] = activePushDrivers()) {
  if (!items.length || !drivers.length) return;
  await Promise.all(
    drivers.map((d) =>
      d.send(items).catch((e) => {
        console.error(`[push] 驱动 ${d.name} 发送失败`, e);
      }),
    ),
  );
}
