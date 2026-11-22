import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@/lib/db";
import { verifyScopedToken } from "@/lib/auth/token";

const PORT = Number(process.env.REALTIME_PORT ?? 1235);
const CHANNEL = "rt:events";

type Client = { ws: WebSocket; userId: string; alive: boolean };
const socketsByUser = new Map<string, Set<Client>>();
const allSockets = new Set<Client>();

function log(...args: unknown[]) {
  console.log(`[rt ${new Date().toLocaleTimeString()}]`, ...args);
}

function send(client: Client, event: object) {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(event));
}

function deliver(userIds: string[], event: object) {
  for (const id of userIds) {
    for (const client of socketsByUser.get(id) ?? []) send(client, event);
  }
}

function broadcastAll(event: object) {
  for (const client of allSockets) send(client, event);
}

// ── 会话成员缓存（typing 校验 + 定向投递共用，60s） ──
const memberCache = new Map<string, { userIds: string[]; expires: number }>();
async function memberIds(conversationId: string): Promise<string[]> {
  const hit = memberCache.get(conversationId);
  if (hit && hit.expires > Date.now()) return hit.userIds;
  const rows = await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  const userIds = rows.map((r) => r.userId);
  memberCache.set(conversationId, { userIds, expires: Date.now() + 60_000 });
  return userIds;
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
    sendJson(res, 200, { ok: true, users: socketsByUser.size, connections: allSockets.size });
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
const wss = new WebSocketServer({ noServer: true });

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
  const client: Client = { ws, userId, alive: true };
  allSockets.add(client);
  let set = socketsByUser.get(userId);
  const isFirst = !set || set.size === 0;
  if (!set) {
    set = new Set();
    socketsByUser.set(userId, set);
  }
  set.add(client);

  send(client, { type: "presence.snapshot", userIds: [...socketsByUser.keys()] });
  if (isFirst) broadcastAll({ type: "presence", userId, online: true });

  ws.on("pong", () => {
    client.alive = true;
  });
  ws.on("message", (data) => {
    client.alive = true;
    let msg: { type?: string; conversationId?: string };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === "ping") return;
    if (msg.type === "typing" && typeof msg.conversationId === "string") {
      void memberIds(msg.conversationId)
        .then((ids) => {
          if (!ids.includes(userId)) return;
          deliver(
            ids.filter((id) => id !== userId),
            { type: "typing", conversationId: msg.conversationId, userId },
          );
        })
        .catch(() => {});
    }
  });
  ws.on("close", () => {
    allSockets.delete(client);
    const set = socketsByUser.get(userId);
    set?.delete(client);
    if (set && set.size === 0) {
      socketsByUser.delete(userId);
      broadcastAll({ type: "presence", userId, online: false });
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
}, 30_000);
heartbeat.unref();

// ── Redis 总线（多实例）：订阅 rt:events 并本地投递 ──
// 已知限制：presence 事件不跨实例传播，presence.snapshot 仅包含本实例在线用户。
if (process.env.REDIS_URL) {
  void (async () => {
    try {
      const mod = (await import("ioredis")) as unknown as {
        default: new (url: string) => { subscribe: (c: string) => Promise<unknown>; on: (e: string, cb: (c: string, m: string) => void) => void };
      };
      const sub = new mod.default(process.env.REDIS_URL!);
      await sub.subscribe(CHANNEL);
      sub.on("message", (_c: string, message: string) => {
        try {
          const item = JSON.parse(message) as { userIds?: unknown; event?: unknown };
          if (Array.isArray(item.userIds) && item.event && typeof item.event === "object") {
            deliver(item.userIds.filter((x): x is string => typeof x === "string"), item.event);
          }
        } catch {}
      });
      log(`已订阅 Redis 频道 ${CHANNEL}`);
    } catch (e) {
      console.error("[rt] Redis 订阅失败，仅本实例投递", e);
    }
  })();
}

server.listen(PORT, () => log(`实时服务已启动 ws://localhost:${PORT}（HTTP /health /publish）`));
