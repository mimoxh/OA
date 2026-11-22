import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Redis as RedisClient } from "ioredis";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@/lib/db";
import { verifyScopedToken } from "@/lib/auth/token";
import { STALE_CALL_MS, type CallPeerInfo } from "@/lib/im/types";

const PORT = Number(process.env.REALTIME_PORT ?? 1235);
const EVENTS_CHANNEL = "rt:events";
const PRESENCE_CHANNEL = "rt:presence";
const INSTANCES_KEY = "rt:instances";
const ONLINE_TTL_SEC = 60;
const INSTANCE_STALE_MS = 65_000;
const PRESENCE_SYNC_MS = 20_000;
const INSTANCE_ID = randomUUID();

const onlineKey = (instanceId: string) => `rt:online:${instanceId}`;
const callRoomKey = (callId: string) => `rt:call:${callId}:peers`;
const CALL_PEER_TTL_SEC = 90;

type Client = { id: string; ws: WebSocket; userId: string; alive: boolean; callId: string | null };
type CallRoomEntry = { peer: CallPeerInfo; conversationId: string; client: Client };
type LeasedCallPeer = { peer: CallPeerInfo; expiresAt: number };

const socketsByUser = new Map<string, Set<Client>>();
const allSockets = new Set<Client>();
const callRooms = new Map<string, Map<string, CallRoomEntry>>();

let redisPub: RedisClient | null = null;
let redisSub: RedisClient | null = null;
let redisReady = false;

function log(...args: unknown[]) {
  console.log(`[rt ${new Date().toLocaleTimeString()}]`, ...args);
}

function send(client: Client, event: object) {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(event));
}

function deliver(userIds: string[], event: object) {
  const callEvent = event as { type?: string; callId?: string; targetConnectionId?: string; peer?: CallPeerInfo };
  if (callEvent.type === "call.ended" && callEvent.callId) {
    const room = callRooms.get(callEvent.callId);
    for (const entry of room?.values() ?? []) entry.client.callId = null;
    callRooms.delete(callEvent.callId);
    if (room && redisReady) void redisPub?.del(callRoomKey(callEvent.callId)).catch(() => {});
  }
  for (const id of userIds) {
    for (const client of socketsByUser.get(id) ?? []) {
      if (callEvent.targetConnectionId && callEvent.targetConnectionId !== client.id) continue;
      if (
        callEvent.type === "call.peer-joined" && callEvent.callId && client.callId === callEvent.callId &&
        callEvent.peer?.userId === client.userId && callEvent.peer.connectionId !== client.id
      ) {
        detachCallPeer(client, callEvent.callId);
        send(client, { type: "call.join-rejected", callId: callEvent.callId });
        continue;
      }
      send(client, event);
    }
  }
}

async function publishOrDeliver(userIds: string[], event: object) {
  if (!userIds.length) return;
  if (redisReady && redisPub) {
    try {
      await redisPub.publish(EVENTS_CHANNEL, JSON.stringify({ userIds, event }));
      return;
    } catch {}
  }
  deliver(userIds, event);
}

function broadcastAll(event: object) {
  for (const client of allSockets) send(client, event);
}

// ── Redis 多实例在线状态辅助 ──
async function getGlobalOnlineUserIds(): Promise<string[]> {
  const local = [...socketsByUser.keys()];
  if (!redisReady || !redisPub) return local;
  try {
    const cutoff = Date.now() - INSTANCE_STALE_MS;
    const instances = await redisPub.zrangebyscore(INSTANCES_KEY, cutoff, "+inf");
    if (!instances.length) return local;
    const remote = await redisPub.sunion(...instances.map(onlineKey));
    return [...new Set([...local, ...remote])];
  } catch {
    return local;
  }
}

async function isOnlineElsewhere(userId: string): Promise<boolean> {
  if (!redisReady || !redisPub) return false;
  try {
    const cutoff = Date.now() - INSTANCE_STALE_MS;
    const others = (await redisPub.zrangebyscore(INSTANCES_KEY, cutoff, "+inf")).filter((id) => id !== INSTANCE_ID);
    if (!others.length) return false;
    const pipe = redisPub.pipeline();
    for (const id of others) pipe.sismember(onlineKey(id), userId);
    const results = await pipe.exec();
    return Boolean(results?.some(([err, val]) => !err && val === 1));
  } catch {
    return false;
  }
}

async function syncInstancePresence() {
  if (!redisReady || !redisPub) return;
  try {
    const now = Date.now();
    const key = onlineKey(INSTANCE_ID);
    const localUsers = [...socketsByUser.keys()];
    const pipe = redisPub.pipeline();
    pipe.zadd(INSTANCES_KEY, now, INSTANCE_ID);
    pipe.zremrangebyscore(INSTANCES_KEY, 0, now - INSTANCE_STALE_MS);
    if (localUsers.length > 0) {
      pipe.sadd(key, ...localUsers);
      pipe.expire(key, ONLINE_TTL_SEC);
    } else {
      pipe.del(key);
    }
    await pipe.exec();
  } catch (e) {
    console.error("[rt] 同步实例在线状态失败", e);
  }
}

// ── 会话成员缓存（typing / call 信令校验 + 定向投递共用，60s） ──
const memberCache = new Map<string, { userIds: string[]; expires: number }>();
async function memberIds(conversationId: string): Promise<string[]> {
  const hit = memberCache.get(conversationId);
  if (hit && hit.expires > Date.now()) return hit.userIds;
  const rows = await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  const userIds = rows.map((r) => r.userId);
  memberCache.set(conversationId, { userIds, expires: Date.now() + 60_000 });
  return userIds;
}

const userLiteCache = new Map<string, { name: string; avatarColor: string; expires: number }>();
async function getUserLite(userId: string): Promise<{ name: string; avatarColor: string }> {
  const hit = userLiteCache.get(userId);
  if (hit && hit.expires > Date.now()) return { name: hit.name, avatarColor: hit.avatarColor };
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, avatarColor: true } });
  const val = { name: u?.name ?? "成员", avatarColor: u?.avatarColor ?? "#2383e2" };
  userLiteCache.set(userId, { ...val, expires: Date.now() + 300_000 });
  return val;
}

async function getCallPeers(callId: string): Promise<CallPeerInfo[]> {
  if (redisReady && redisPub) {
    try {
      const now = Date.now();
      const peers = await redisPub.hvals(callRoomKey(callId));
      return peers.map((value) => JSON.parse(value) as LeasedCallPeer)
        .filter((entry) => entry.expiresAt > now)
        .map((entry) => entry.peer);
    } catch {}
  }
  return [...(callRooms.get(callId)?.values() ?? [])].map((entry) => entry.peer);
}

// 每个用户在房间里只占一个位置。只有持有该位置的连接能续租、更新或离开。
const updateCallPeerLease = `
local value = redis.call('HGET', KEYS[1], ARGV[1])
if not value or cjson.decode(value).peer.connectionId ~= ARGV[2] then return 0 end
if ARGV[3] == '' then
  redis.call('HDEL', KEYS[1], ARGV[1])
else
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
  redis.call('EXPIRE', KEYS[1], ARGV[4])
end
return 1
`;

async function saveCallPeer(callId: string, peer: CallPeerInfo, joining = false): Promise<boolean> {
  if (!redisReady || !redisPub) return true;
  const key = callRoomKey(callId);
  const value = JSON.stringify({ peer, expiresAt: Date.now() + CALL_PEER_TTL_SEC * 1000 });
  if (joining) {
    const result = await redisPub.multi().hset(key, peer.userId, value).expire(key, CALL_PEER_TTL_SEC).exec();
    return result?.every(([error]) => !error) ?? false;
  }
  return await redisPub.eval(updateCallPeerLease, 1, key, peer.userId, peer.connectionId, value, CALL_PEER_TTL_SEC) === 1;
}

function detachCallPeer(client: Client, callId: string): CallRoomEntry | undefined {
  if (client.callId !== callId) return;
  client.callId = null;
  const room = callRooms.get(callId);
  const entry = room?.get(client.userId);
  if (!room || entry?.client !== client) return;
  room.delete(client.userId);
  if (!room.size) callRooms.delete(callId);
  return entry;
}

async function leaveCallRoom(client: Client, callId = client.callId) {
  if (!callId) return;
  const entry = detachCallPeer(client, callId);
  if (!entry) return;
  if (redisReady && redisPub) {
    const removed = await redisPub.eval(
      updateCallPeerLease, 1, callRoomKey(callId), client.userId, client.id, "", CALL_PEER_TTL_SEC,
    );
    if (removed !== 1) return;
  }
  const { conversationId } = entry;
  const [peers, ids] = await Promise.all([getCallPeers(callId), memberIds(conversationId)]);
  await publishOrDeliver(ids, {
    type: "call.peer-left", callId, conversationId, userId: client.userId,
    connectionId: client.id, peerCount: peers.length,
  });
}

function sendCallPeers(client: Client, callId: string, conversationId: string, peers: CallPeerInfo[]) {
  send(client, {
    type: "call.peers", callId, conversationId, peerCount: peers.length,
    peers: peers.filter((peer) => peer.userId !== client.userId),
  });
}

async function handleCallMessage(client: Client, msg: Record<string, unknown>) {
  if (typeof msg.callId !== "string") return;
  const callId = msg.callId;
  const userId = client.userId;
  if (msg.type === "call.join") {
    const call = await db.callSession.findFirst({
      where: {
        id: callId,
        status: { in: ["RINGING", "ACTIVE"] },
        startedAt: { gt: new Date(Date.now() - STALE_CALL_MS) },
        conversation: { members: { some: { userId } } },
      },
      select: { conversationId: true },
    });
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (!call || call.conversationId !== msg.conversationId) {
      send(client, { type: "call.join-rejected", callId });
      return;
    }

    const { conversationId } = call;
    const [ids, lite] = await Promise.all([memberIds(conversationId), getUserLite(userId)]);
    if (client.callId && client.callId !== callId) await leaveCallRoom(client);
    if (client.ws.readyState !== WebSocket.OPEN) return;

    const peer = {
      connectionId: client.id,
      userId,
      ...lite,
      audio: msg.audio === true,
      video: msg.video === true,
      screen: msg.screen === true,
    };
    if (!await saveCallPeer(callId, peer, true)) {
      send(client, { type: "call.join-rejected", callId });
      return;
    }
    let room = callRooms.get(callId);
    if (!room) {
      room = new Map();
      callRooms.set(callId, room);
    }
    const previous = room.get(userId)?.client;
    if (previous && previous !== client) {
      previous.callId = null;
      send(previous, { type: "call.join-rejected", callId });
    }
    room.set(userId, { peer, conversationId, client });
    client.callId = callId;
    const peers = await getCallPeers(callId);
    if (!peers.some((entry) => entry.connectionId === client.id)) {
      detachCallPeer(client, callId);
      send(client, { type: "call.join-rejected", callId });
      return;
    }
    sendCallPeers(client, callId, conversationId, peers);
    await publishOrDeliver(ids, { type: "call.peer-joined", callId, conversationId, peer, peerCount: peers.length });
    return;
  }

  if (msg.type === "call.leave") {
    await leaveCallRoom(client, callId);
    return;
  }
  const entry = callRooms.get(callId)?.get(userId);
  if (client.callId !== callId || entry?.client !== client) return;
  const { conversationId, peer } = entry;
  if (msg.type === "call.media") {
    for (const kind of ["audio", "video", "screen"] as const) {
      if (typeof msg[kind] === "boolean") peer[kind] = msg[kind];
    }
    if (!await saveCallPeer(callId, peer)) return;
    const peers = await getCallPeers(callId);
    await publishOrDeliver(peers.filter((other) => other.userId !== userId).map((other) => other.userId), {
      type: "call.peer-media", callId, conversationId, ...peer,
    });
    return;
  }
  if (msg.type !== "call.signal" || msg.conversationId !== conversationId || !msg.data) return;
  const peers = await getCallPeers(callId);
  if (!peers.some((other) => other.connectionId === client.id)) return;
  const target = peers.find((other) => other.userId === msg.targetUserId && other.userId !== userId);
  if (!target) return;
  await publishOrDeliver([target.userId], {
    type: "call.signal", conversationId, callId, peer, data: msg.data,
    targetConnectionId: target.connectionId,
  });
}

async function syncCallRooms() {
  if (!redisReady) return;
  for (const [callId, entries] of callRooms) {
    await Promise.all([...entries.values()].map(({ peer }) => saveCallPeer(callId, peer)));
    const peers = await getCallPeers(callId);
    for (const entry of entries.values()) {
      if (peers.some((peer) => peer.connectionId === entry.client.id)) {
        sendCallPeers(entry.client, callId, entry.conversationId, peers);
      }
    }
  }
}

// ── HTTP ──
function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      users: socketsByUser.size,
      connections: allSockets.size,
      callRooms: callRooms.size,
      redis: redisReady,
      instanceId: INSTANCE_ID,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/publish") {
    const auth = req.headers.authorization ?? "";
    const session = await verifyScopedToken(auth.startsWith("Bearer ") ? auth.slice(7) : null, "rt-publish");
    if (!session) {
      sendJson(res, 401, { ok: false, error: "未授权" });
      return;
    }
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      // 统一为批量：{ batch: [{userIds, event}] }；单条 {userIds, event} 也兼容
      const items: { userIds?: unknown; event?: unknown }[] = Array.isArray(body.batch) ? body.batch : [body];
      let n = 0;
      for (const item of items) {
        if (!Array.isArray(item?.userIds) || !item?.event || typeof item.event !== "object") continue;
        deliver(item.userIds.filter((x): x is string => typeof x === "string"), item.event);
        n++;
      }
      sendJson(res, 200, { ok: true, delivered: n });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : "参数错误" });
    }
    return;
  }
  sendJson(res, 404, { ok: false, error: "not found" });
});

// ── WebSocket ──
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const token = url.searchParams.get("token");
  verifyScopedToken(token, "rt")
    .then((session) => {
      if (!session?.userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, session.userId!));
    })
    .catch(() => socket.destroy());
});

function onConnect(ws: WebSocket, userId: string) {
  const client: Client = { id: randomUUID(), ws, userId, alive: true, callId: null };
  let callOperations = Promise.resolve();
  allSockets.add(client);
  let set = socketsByUser.get(userId);
  const isFirst = !set || set.size === 0;
  if (!set) {
    set = new Set();
    socketsByUser.set(userId, set);
  }
  set.add(client);

  if (redisReady && redisPub) {
    const pub = redisPub;
    void (async () => {
      if (isFirst) {
        try {
          const key = onlineKey(INSTANCE_ID);
          await pub
            .pipeline()
            .sadd(key, userId)
            .expire(key, ONLINE_TTL_SEC)
            .zadd(INSTANCES_KEY, Date.now(), INSTANCE_ID)
            .exec();
          await pub.publish(PRESENCE_CHANNEL, JSON.stringify({ instanceId: INSTANCE_ID, userId, online: true }));
        } catch {}
      }
      const userIds = await getGlobalOnlineUserIds();
      send(client, { type: "presence.snapshot", userIds });
    })();
  } else {
    send(client, { type: "presence.snapshot", userIds: [...socketsByUser.keys()] });
  }
  if (isFirst) broadcastAll({ type: "presence", userId, online: true });

  ws.on("pong", () => {
    client.alive = true;
  });
  ws.on("message", (data) => {
    client.alive = true;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || msg.type === "ping") return;
    if (msg.type === "typing" && typeof msg.conversationId === "string") {
      const conversationId = msg.conversationId;
      void memberIds(conversationId)
        .then((ids) => {
          if (!ids.includes(userId)) return;
          return publishOrDeliver(
            ids.filter((id) => id !== userId),
            { type: "typing", conversationId, userId },
          );
        })
        .catch(() => {});
      return;
    }
    if (typeof msg.type === "string" && msg.type.startsWith("call.")) {
      callOperations = callOperations.then(() => handleCallMessage(client, msg)).catch(() => {
        if (msg.type === "call.join") send(client, { type: "call.join-rejected", callId: msg.callId });
      });
    }
  });
  ws.on("close", () => {
    void callOperations.then(() => leaveCallRoom(client)).catch(() => {});
    allSockets.delete(client);
    const set = socketsByUser.get(userId);
    set?.delete(client);
    if (set && set.size === 0) {
      socketsByUser.delete(userId);
      if (redisReady && redisPub) {
        const pub = redisPub;
        void (async () => {
          try {
            await pub.srem(onlineKey(INSTANCE_ID), userId);
            if (socketsByUser.has(userId)) return;
            const elsewhere = await isOnlineElsewhere(userId);
            if (elsewhere || socketsByUser.has(userId)) return;
            broadcastAll({ type: "presence", userId, online: false });
            await pub.publish(PRESENCE_CHANNEL, JSON.stringify({ instanceId: INSTANCE_ID, userId, online: false }));
          } catch {
            if (!socketsByUser.has(userId)) broadcastAll({ type: "presence", userId, online: false });
          }
        })();
      } else {
        broadcastAll({ type: "presence", userId, online: false });
      }
    }
  });
  ws.on("error", () => {});
}

// 心跳：30s 一次，两次未应答的连接被回收
const heartbeat = setInterval(() => {
  for (const client of allSockets) {
    if (!client.alive) {
      client.ws.terminate();
      continue;
    }
    client.alive = false;
    client.ws.ping();
  }
  void syncCallRooms().catch(() => {});
}, 30_000);
heartbeat.unref();

// ── Redis 总线（多实例）：事件投递 + 跨实例在线状态 ──
let presenceSyncTimer: ReturnType<typeof setInterval> | null = null;

if (process.env.REDIS_URL) {
  void (async () => {
    try {
      const { default: IORedis } = await import("ioredis");
      const pub = new IORedis(process.env.REDIS_URL!);
      const sub = new IORedis(process.env.REDIS_URL!);
      pub.on("error", (err) => console.error("[rt] Redis pub 错误:", err.message));
      sub.on("error", (err) => console.error("[rt] Redis sub 错误:", err.message));

      await sub.subscribe(EVENTS_CHANNEL, PRESENCE_CHANNEL);
      redisPub = pub;
      redisSub = sub;
      redisReady = true;

      sub.on("message", (channel: string, message: string) => {
        try {
          if (channel === EVENTS_CHANNEL) {
            const item = JSON.parse(message) as { userIds?: unknown; event?: unknown };
            if (Array.isArray(item.userIds) && item.event && typeof item.event === "object") {
              deliver(item.userIds.filter((x): x is string => typeof x === "string"), item.event);
            }
            return;
          }
          if (channel === PRESENCE_CHANNEL) {
            const item = JSON.parse(message) as { instanceId?: unknown; userId?: unknown; online?: unknown };
            if (item.instanceId === INSTANCE_ID) return;
            if (typeof item.userId !== "string" || typeof item.online !== "boolean") return;
            if (!item.online && socketsByUser.has(item.userId)) return;
            broadcastAll({ type: "presence", userId: item.userId, online: item.online });
          }
        } catch {}
      });

      pub.on("ready", () => {
        void syncInstancePresence();
      });
      await syncInstancePresence();
      presenceSyncTimer = setInterval(() => void syncInstancePresence(), PRESENCE_SYNC_MS);
      presenceSyncTimer.unref();

      log(`已启用 Redis 多实例总线（频道 ${EVENTS_CHANNEL}, ${PRESENCE_CHANNEL}，实例 ${INSTANCE_ID.slice(0, 8)}）`);
    } catch (e) {
      console.error("[rt] Redis 连接失败，回退为单实例模式", e);
    }
  })();
}

// ── 优雅退出（清理本实例在线集合并广播离线） ──
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  if (presenceSyncTimer) clearInterval(presenceSyncTimer);
  await Promise.allSettled([...allSockets].map((client) => leaveCallRoom(client)));
  if (redisReady && redisPub) {
    try {
      const localUsers = [...socketsByUser.keys()];
      await redisPub.pipeline().del(onlineKey(INSTANCE_ID)).zrem(INSTANCES_KEY, INSTANCE_ID).exec();
      for (const userId of localUsers) {
        const elsewhere = await isOnlineElsewhere(userId);
        if (!elsewhere) {
          await redisPub.publish(PRESENCE_CHANNEL, JSON.stringify({ instanceId: INSTANCE_ID, userId, online: false }));
        }
      }
    } catch {}
  }
  await Promise.allSettled([redisPub?.quit(), redisSub?.quit()]);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void shutdown());
}

server.listen(PORT, () => log(`实时服务已启动 ws://localhost:${PORT}（HTTP /health /publish）`));
