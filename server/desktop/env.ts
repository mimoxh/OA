/**
 * 桌面端内置服务端的环境变量合并（纯函数，便于单测）。
 * 优先级：桌面端管理的键 > 进程环境变量 > 数据目录 .env > 桌面端默认值。
 * 管理的键（壳传入的启动参数与 main.ts 计算出的数据库、密钥、内部端口等）不能被 .env 改写。
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

/** 壳传入的启动参数：只认进程环境变量 */
export const SHELL_KEYS = ["OA_DATA_DIR", "OA_PORT", "OA_BIND", "OA_CONTROL_TOKEN", "OA_MIGRATIONS_DIR"] as const;

export type EnvMap = Record<string, string | undefined>;

export function readDataDirEnv(dataDir: string): { file: string; vars: Record<string, string> } | null {
  const file = path.join(dataDir, ".env");
  if (!fs.existsSync(file)) return null;
  return { file, vars: parse(fs.readFileSync(file)) };
}

/** Webhook reply.endpoint 等回调地址：监听所有网卡时对本机 Bot 使用回环地址 */
export function localBaseUrl(bind: string, port: number): string {
  const host = !bind || bind === "0.0.0.0" || bind === "::" ? "127.0.0.1" : bind.includes(":") ? `[${bind}]` : bind;
  return `http://${host}:${port}`;
}

export function desktopDefaults(bind: string, port: number): Record<string, string> {
  return {
    OA_PUBLIC_BASE_URL: localBaseUrl(bind, port),
    // 本机自托管：默认允许推送到本机 / 局域网 Bot，以及经代理 FakeIP 解析的域名；显式设为 false 时仍严格拦截
    WEBHOOK_ALLOW_PRIVATE_NETWORK: "true",
  };
}

const isSet = (v: string | undefined): v is string => v !== undefined && v.trim() !== "";

/** 返回需要写入 process.env 的键值，以及 .env 中因受保护被忽略的键 */
export function mergeDesktopEnv(input: {
  processEnv: EnvMap;
  fileEnv?: Record<string, string>;
  managed: Record<string, string>;
  defaults?: Record<string, string>;
}): { env: Record<string, string>; ignored: string[] } {
  const { processEnv, fileEnv = {}, managed, defaults = {} } = input;
  // Windows 的环境变量名不区分大小写，按大写比较，防止 node_env 之类绕过保护
  const protectedKeys = new Set([...SHELL_KEYS, ...Object.keys(managed)].map((k) => k.toUpperCase()));
  const env: Record<string, string> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(fileEnv)) {
    if (protectedKeys.has(key.toUpperCase())) ignored.push(key);
    else if (!isSet(processEnv[key])) env[key] = value;
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (protectedKeys.has(key.toUpperCase())) continue;
    if (!isSet(processEnv[key]) && !isSet(env[key])) env[key] = value;
  }
  return { env: { ...env, ...managed }, ignored };
}
