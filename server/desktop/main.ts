/**
 * 桌面一体包的服务端入口（由 scripts/desktop/bundle-server.mjs 打包为 standalone 目录内的 oa-server.mjs）。
 * Tauri 壳以子进程启动它，一个 Node 进程内同时运行：
 *   网关（对外端口）→ Next standalone / 协同服务 / 实时服务（随机回环端口）
 * 壳传入的环境变量：
 *   OA_DATA_DIR       数据目录（数据库、附件、密钥、备份）
 *   OA_PORT           对外端口（默认 17300）
 *   OA_BIND           监听地址：127.0.0.1 仅本机 / 0.0.0.0 允许局域网访问
 *   OA_CONTROL_TOKEN  壳的控制令牌（优雅退出）
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "./migrate";
import { startGateway } from "./gateway";

/** 端口被占用：壳据此退出码给出可读提示 */
const EXIT_PORT_IN_USE = 98;

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

function log(...args: unknown[]) {
  console.log(`[oa ${new Date().toLocaleTimeString()}]`, ...args);
}

function loadOrCreateSecret(file: string) {
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file, "utf8").trim();
    if (value.length >= 32) return value;
  }
  const value = randomBytes(48).toString("base64url");
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

function ensurePortFree(port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(port, host, () => srv.close(() => resolve()));
  });
}

/** 申请若干个随机回环端口：全部占住后再一起释放，避免拿到重复端口 */
async function freePorts(count: number) {
  const servers: net.Server[] = [];
  const ports: number[] = [];
  for (let i = 0; i < count; i++) {
    const srv = net.createServer();
    await new Promise<void>((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => resolve());
    });
    servers.push(srv);
    ports.push((srv.address() as net.AddressInfo).port);
  }
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  return ports;
}

async function waitForHttp(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/login`, { method: "HEAD", redirect: "manual" });
      if (res.status > 0) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Next 服务 ${timeoutMs / 1000} 秒内未就绪`);
}

async function main() {
  const dataDir = process.env.OA_DATA_DIR;
  if (!dataDir) throw new Error("未设置 OA_DATA_DIR");
  const port = Number(process.env.OA_PORT ?? 17300);
  const bind = process.env.OA_BIND ?? "127.0.0.1";
  const migrationsDir = process.env.OA_MIGRATIONS_DIR ?? path.join(APP_DIR, "migrations");

  const dirs = {
    attachments: path.join(dataDir, "attachments"),
    uploads: path.join(dataDir, "uploads"),
    backups: path.join(dataDir, "backups"),
  };
  for (const dir of [dataDir, ...Object.values(dirs)]) fs.mkdirSync(dir, { recursive: true });

  try {
    await ensurePortFree(port, bind);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE" || (e as NodeJS.ErrnoException).code === "EACCES") {
      console.error(`[oa] 端口 ${port} 已被其他程序占用`);
      process.exit(EXIT_PORT_IN_USE);
    }
    throw e;
  }

  const dbFile = path.join(dataDir, "oa.db");
  const applied = migrate(dbFile, migrationsDir, dirs.backups);
  if (applied.length) log("已执行数据库迁移：", applied.join(", "));

  const [nextPort, collabPort, rtPort] = await freePorts(3);
  Object.assign(process.env, {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `file:${dbFile}`,
    AUTH_SECRET: loadOrCreateSecret(path.join(dataDir, "secret.key")),
    ATTACHMENT_DIR: dirs.attachments,
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: dirs.uploads,
    COLLAB_PORT: String(collabPort),
    COLLAB_HOST: "127.0.0.1",
    COLLAB_HTTP_URL: `http://127.0.0.1:${collabPort}`,
    COLLAB_PUBLIC_URL: "/collab",
    REALTIME_PORT: String(rtPort),
    REALTIME_HOST: "127.0.0.1",
    REALTIME_INTERNAL_URL: `http://127.0.0.1:${rtPort}`,
    REALTIME_PUBLIC_URL: "/rt",
    SESSION_COOKIE_SECURE: "false",
    PORT: String(nextPort),
    HOSTNAME: "127.0.0.1",
  });

  // 独立入口文件（代码拆分共享 Prisma 等模块），模块加载即开始监听，所以要在设置好环境变量之后再导入
  await import(pathToFileURL(path.join(APP_DIR, "oa-collab.mjs")).href);
  await import(pathToFileURL(path.join(APP_DIR, "oa-realtime.mjs")).href);
  createRequire(import.meta.url)(path.join(APP_DIR, "server.js"));
  await waitForHttp(nextPort, 60_000);

  await startGateway({
    port,
    host: bind,
    nextPort,
    collabPort,
    rtPort,
    controlToken: process.env.OA_CONTROL_TOKEN ?? "",
    onShutdown: () => {
      log("收到退出请求，正在保存文档并退出");
      // 协同 / 实时服务各自在 SIGINT 上注册了清理逻辑（协同服务会先把未保存的文档写入数据库）
      process.emit("SIGINT");
      setTimeout(() => process.exit(0), 8000).unref();
    },
  });
  log(`已就绪 http://${bind === "0.0.0.0" ? "127.0.0.1" : bind}:${port}${bind === "0.0.0.0" ? "（已允许局域网访问）" : ""}`);
}

main().catch((e) => {
  console.error("[oa] 启动失败：", e);
  process.exit(1);
});
