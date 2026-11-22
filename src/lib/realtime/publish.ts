import { signScopedToken } from "@/lib/auth/token";

export type PublishItem = { userIds: string[]; event: Record<string, unknown> };

const CHANNEL = "rt:events";
const TIMEOUT_MS = 1500;

type RedisClient = { publish: (channel: string, message: string) => Promise<unknown>; quit: () => Promise<unknown> };
let redis: RedisClient | null = null;
let redisFailed = false;

async function getRedis(url: string): Promise<RedisClient | null> {
  if (redis) return redis;
  if (redisFailed) return null;
  try {
    const mod = (await import("ioredis")) as unknown as { default: new (url: string, opts?: object) => RedisClient };
    redis = new mod.default(url, { lazyConnect: false, maxRetriesPerRequest: 1 });
    return redis;
  } catch (e) {
    redisFailed = true;
    console.error("[realtime] Redis 连接失败，回退 HTTP 投递", e);
    return null;
  }
}

function internalUrl() {
  return process.env.REALTIME_INTERNAL_URL ?? `http://localhost:${process.env.REALTIME_PORT ?? 1235}`;
}

/**
 * 把一批事件投递给实时服务：配置了 REDIS_URL 时走 Redis 频道（多实例），
 * 否则直接 POST 到实时服务的 /publish 入口。永不抛出。
 */
export async function publish(batch: PublishItem[]) {
  if (!batch.length) return;
  try {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const client = await getRedis(redisUrl);
      if (client) {
        await Promise.all(batch.map((item) => client.publish(CHANNEL, JSON.stringify(item))));
        return;
      }
    }
    const token = await signScopedToken("rt-publish", null, 60);
    await fetch(`${internalUrl()}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ batch }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[realtime] 事件投递失败（客户端会在重连后通过 seq 补齐）", e);
  }
}
