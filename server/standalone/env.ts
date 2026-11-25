/**
 * 容器 / NAS 单端口独立部署模式的环境变量解析与运行时参数构建（纯函数，便于单测）。
 *
 * 与桌面端（server/desktop/env.ts）的区别：
 * - 不读取数据目录 .env（容器由 docker-compose / env_file 统一注入环境变量）；
 * - 允许显式配置 DATABASE_URL / ATTACHMENT_DIR / STORAGE_LOCAL_DIR / STORAGE_DRIVER / AUTH_SECRET；
 * - 未设置 AUTH_SECRET 时优先复用 <dbDir>/secret.key（便于直接迁移桌面端数据），否则自动生成并持久化；
 * - 强制把 Next / Hocuspocus / Realtime 绑定在 127.0.0.1 随机回环端口，对外仅暴露单网关端口。
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type EnvMap = Record<string, string | undefined>;

export type StandaloneConfig = {
  port: number;
  bind: string;
  dataDir: string;
  dbFile: string;
  backupDir: string;
  attachmentDir: string;
  storageDriver: string;
  storageLocalDir: string;
  migrationsDir: string;
  secretFile: string;
};

export type InternalPorts = {
  nextPort: number;
  collabPort: number;
  rtPort: number;
};

const nonEmpty = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * 解析 Prisma SQLite `file:` 连接串为本地文件路径（与 @prisma/adapter-better-sqlite3 保持一致）。
 * 示例：file:/data/db/oa.db -> /data/db/oa.db；file:./prisma/dev.db -> <cwd>/prisma/dev.db
 */
export function parseSqliteFilePath(databaseUrl: string, cwd: string = process.cwd()): string {
  const raw = databaseUrl.trim();
  if (!raw.startsWith("file:")) {
    throw new Error(`单容器独立模式仅支持 SQLite file: 连接串，收到 DATABASE_URL=${raw}`);
  }
  const withoutQuery = raw.slice("file:".length).split("?")[0]?.trim() ?? "";
  if (!withoutQuery || withoutQuery === ":memory:") {
    throw new Error("DATABASE_URL 必须指向具体的 SQLite 文件路径，不能使用内存库");
  }
  return path.isAbsolute(withoutQuery) ? withoutQuery : path.resolve(cwd, withoutQuery);
}

export function resolveStandaloneConfig(env: EnvMap, appDir: string, cwd: string = process.cwd()): StandaloneConfig {
  const portRaw = nonEmpty(env.OA_PORT) ?? nonEmpty(env.PORT) ?? "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无效的监听端口：${portRaw}`);
  }
  const bind = nonEmpty(env.OA_BIND) ?? nonEmpty(env.HOSTNAME) ?? "0.0.0.0";
  const dataDir = path.resolve(cwd, nonEmpty(env.OA_DATA_DIR) ?? "/data");
  const dbUrl = nonEmpty(env.DATABASE_URL);
  const dbFile = dbUrl ? parseSqliteFilePath(dbUrl, cwd) : path.join(dataDir, "db", "oa.db");
  const dbDir = path.dirname(dbFile);
  const backupDir = path.resolve(cwd, nonEmpty(env.OA_BACKUP_DIR) ?? path.join(dbDir, "backups"));
  const attachmentDir = path.resolve(cwd, nonEmpty(env.ATTACHMENT_DIR) ?? path.join(dataDir, "attachments"));
  const storageDriver = (nonEmpty(env.STORAGE_DRIVER) ?? (nonEmpty(env.S3_BUCKET) ? "s3" : "local")).toLowerCase();
  const storageLocalDir = path.resolve(cwd, nonEmpty(env.STORAGE_LOCAL_DIR) ?? path.join(dataDir, "uploads"));
  const migrationsDir = path.resolve(cwd, nonEmpty(env.OA_MIGRATIONS_DIR) ?? path.join(appDir, "migrations"));
  const secretFile = path.resolve(cwd, nonEmpty(env.OA_SECRET_FILE) ?? path.join(dbDir, "secret.key"));

  return {
    port,
    bind,
    dataDir,
    dbFile,
    backupDir,
    attachmentDir,
    storageDriver,
    storageLocalDir,
    migrationsDir,
    secretFile,
  };
}

export type AuthSecretResult = {
  secret: string;
  source: "env" | "file" | "generated";
};

/**
 * 解析会话与 Webhook 凭据加密密钥：
 * 1. 显式环境变量 AUTH_SECRET 优先；
 * 2. 若数据目录已存在 secret.key（含桌面端迁移过来的密钥文件）则直接复用；
 * 3. 均不存在时自动生成 48 字节高熵随机密钥并持久化到 secret.key。
 */
export function resolveAuthSecret(envSecret: string | undefined, secretFile: string): AuthSecretResult {
  const fromEnv = nonEmpty(envSecret);
  if (fromEnv) return { secret: fromEnv, source: "env" };

  if (fs.existsSync(secretFile)) {
    const fromFile = fs.readFileSync(secretFile, "utf8").trim();
    if (fromFile.length >= 16) return { secret: fromFile, source: "file" };
  }

  const generated = randomBytes(48).toString("base64url");
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return { secret: generated, source: "generated" };
}

/** 生成注入到当前 Node 进程的运行时环境变量（仅覆盖网关/内部端口与解析后的存储路径） */
export function buildStandaloneRuntimeEnv(
  cfg: StandaloneConfig,
  ports: InternalPorts,
  authSecret: string,
  processEnv: EnvMap,
): Record<string, string> {
  return {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `file:${cfg.dbFile}`,
    AUTH_SECRET: authSecret,
    ATTACHMENT_DIR: cfg.attachmentDir,
    STORAGE_DRIVER: cfg.storageDriver,
    STORAGE_LOCAL_DIR: cfg.storageLocalDir,
    COLLAB_PORT: String(ports.collabPort),
    COLLAB_HOST: "127.0.0.1",
    COLLAB_HTTP_URL: `http://127.0.0.1:${ports.collabPort}`,
    COLLAB_PUBLIC_URL: nonEmpty(processEnv.COLLAB_PUBLIC_URL) ?? "/collab",
    REALTIME_PORT: String(ports.rtPort),
    REALTIME_HOST: "127.0.0.1",
    REALTIME_INTERNAL_URL: `http://127.0.0.1:${ports.rtPort}`,
    REALTIME_PUBLIC_URL: nonEmpty(processEnv.REALTIME_PUBLIC_URL) ?? "/rt",
    PORT: String(ports.nextPort),
    HOSTNAME: "127.0.0.1",
  };
}
