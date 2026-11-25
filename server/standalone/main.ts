/**
 * 容器 / NAS 单端口独立运行入口（由 scripts/docker/bundle-server.mjs 打包为 oa-standalone.mjs）。
 * 单 Node 进程内统一运行：
 *   对外网关（默认 0.0.0.0:3000）→ Next standalone / Hocuspocus 协同 / Realtime WS（内部 127.0.0.1 随机端口）
 *
 * 特性：
 * - 内部管理端口与 /publish、/restore、/broadcast 等接口仅监听 127.0.0.1，不对外暴露；
 * - 公开 GET /health 探活接口供 Docker HEALTHCHECK 与反向代理使用；
 * - 启动时自动建目录、开启 SQLite WAL、自动识别已有库基线并先备份再迁移；
 * - 收到 SIGINT / SIGTERM 时优雅关闭网关并触发协同文档刷盘。
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startGateway } from "../desktop/gateway";
import { migrate } from "../desktop/migrate";
import { buildStandaloneRuntimeEnv, resolveAuthSecret, resolveStandaloneConfig } from "./env";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEV_PLACEHOLDER_SECRET = "dev-only-secret-change-me-in-production-0123456789";

function log(...args: unknown[]) {
  console.log(`[oa ${new Date().toISOString()}]`, ...args);
}

function ensurePortFree(port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(port, host, () => srv.close(() => resolve()));
  });
}

/** 申请若干个随机回环端口：全部占住后再统一释放，避免冲突 */
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

async function probeOk(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHttp(port: number, urlPath: string, label: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(1500),
      });
      if (res.status > 0) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${label} 在 ${timeoutMs / 1000} 秒内未就绪`);
}

async function main() {
  const cfg = resolveStandaloneConfig(process.env, APP_DIR);

  const dirsToCreate = [path.dirname(cfg.dbFile), cfg.backupDir, cfg.attachmentDir];
  if (cfg.storageDriver !== "s3") dirsToCreate.push(cfg.storageLocalDir);
  for (const dir of dirsToCreate) fs.mkdirSync(dir, { recursive: true });

  await ensurePortFree(cfg.port, cfg.bind);

  const auth = resolveAuthSecret(process.env.AUTH_SECRET, cfg.secretFile);
  if (auth.source === "generated") {
    log(`未设置 AUTH_SECRET，已自动生成并持久化到 ${cfg.secretFile}（请妥善备份，切勿随意更换）`);
  } else if (auth.source === "file") {
    log(`已从 ${cfg.secretFile} 加载 AUTH_SECRET`);
  } else if (auth.secret === DEV_PLACEHOLDER_SECRET || auth.secret.length < 32) {
    console.warn("[oa] 警告：AUTH_SECRET 过短或仍为示例默认值，请在生产环境更换为至少 32 位随机密钥");
  }

  const applied = migrate(cfg.dbFile, cfg.migrationsDir, cfg.backupDir);
  if (applied.length) log("已执行数据库迁移：", applied.join(", "));
  else log("数据库结构已是最新（SQLite WAL 模式）");

  const [nextPort, collabPort, rtPort] = await freePorts(3);
  const runtimeEnv = buildStandaloneRuntimeEnv(cfg, { nextPort, collabPort, rtPort }, auth.secret, process.env);
  Object.assign(process.env, runtimeEnv);

  // 先加载协同与实时服务，再启动 Next standalone（均绑定在 127.0.0.1 随机端口）
  await import(pathToFileURL(path.join(APP_DIR, "oa-collab.mjs")).href);
  await import(pathToFileURL(path.join(APP_DIR, "oa-realtime.mjs")).href);
  createRequire(import.meta.url)(path.join(APP_DIR, "server.js"));

  await Promise.all([
    waitForHttp(nextPort, "/login", "Next 服务", 60_000),
    waitForHttp(collabPort, "/health", "协同服务", 30_000),
    waitForHttp(rtPort, "/health", "实时服务", 30_000),
  ]);

  const gateway = await startGateway({
    port: cfg.port,
    host: cfg.bind,
    nextPort,
    collabPort,
    rtPort,
    enableControl: false,
    healthCheck: async () => {
      const [collab, realtime] = await Promise.all([
        probeOk(`http://127.0.0.1:${collabPort}/health`),
        probeOk(`http://127.0.0.1:${rtPort}/health`),
      ]);
      return { ok: collab && realtime, services: { next: true, collab, realtime } };
    },
  });

  // 协同与实时服务已注册 SIGINT / SIGTERM 清理逻辑；这里先停止对外接收新连接
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      gateway.close();
      setTimeout(() => process.exit(0), 8000).unref();
    });
  }

  log(
    `服务已就绪 http://${cfg.bind}:${cfg.port}（DB=${cfg.dbFile}，附件=${cfg.attachmentDir}，存储=${cfg.storageDriver}，CookieSecure=${process.env.SESSION_COOKIE_SECURE !== "false"}）`,
  );
}

main().catch((e) => {
  console.error("[oa] 启动失败：", e);
  process.exit(1);
});
