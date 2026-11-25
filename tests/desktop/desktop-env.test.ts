import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SHELL_KEYS, desktopDefaults, localBaseUrl, mergeDesktopEnv, readDataDirEnv } from "../../server/desktop/env";

const managed = {
  NODE_ENV: "production",
  DATABASE_URL: "file:C:/data/oa.db",
  AUTH_SECRET: "managed-secret",
  COLLAB_PORT: "50001",
  REALTIME_PORT: "50002",
  PORT: "50003",
  HOSTNAME: "127.0.0.1",
};

function merge(processEnv: Record<string, string | undefined>, fileEnv?: Record<string, string>, bind = "127.0.0.1", port = 17300) {
  return mergeDesktopEnv({ processEnv, fileEnv, managed, defaults: desktopDefaults(bind, port) });
}

describe("桌面端 dataDir/.env 读取", () => {
  it("文件不存在时返回 null，存在时按 dotenv 语法解析", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-desktop-env-"));
    try {
      assert.equal(readDataDirEnv(dir), null);
      fs.writeFileSync(
        path.join(dir, ".env"),
        '# 注释\nWEBHOOK_ALLOW_PRIVATE_NETWORK=false\nOA_PUBLIC_BASE_URL="http://192.168.1.20:17300"\nWEBHOOK_ALLOWED_HOSTS=bot.lan,*.example.com\n',
      );
      const loaded = readDataDirEnv(dir);
      assert.equal(loaded?.file, path.join(dir, ".env"));
      assert.deepEqual(loaded?.vars, {
        WEBHOOK_ALLOW_PRIVATE_NETWORK: "false",
        OA_PUBLIC_BASE_URL: "http://192.168.1.20:17300",
        WEBHOOK_ALLOWED_HOSTS: "bot.lan,*.example.com",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("桌面端环境变量合并", () => {
  it("无任何配置时：写入管理键，自动推导 OA_PUBLIC_BASE_URL，默认放行内网", () => {
    const { env, ignored } = merge({ OA_PORT: "17300" });
    assert.deepEqual(ignored, []);
    for (const [k, v] of Object.entries(managed)) assert.equal(env[k], v);
    assert.equal(env.OA_PUBLIC_BASE_URL, "http://127.0.0.1:17300");
    assert.equal(env.WEBHOOK_ALLOW_PRIVATE_NETWORK, "true");
  });
  it("OA_PUBLIC_BASE_URL 跟随实际监听端口，0.0.0.0 / :: 时使用回环地址", () => {
    assert.equal(merge({}, undefined, "127.0.0.1", 18080).env.OA_PUBLIC_BASE_URL, "http://127.0.0.1:18080");
    assert.equal(merge({}, undefined, "0.0.0.0", 17300).env.OA_PUBLIC_BASE_URL, "http://127.0.0.1:17300");
    assert.equal(localBaseUrl("::", 17300), "http://127.0.0.1:17300");
    assert.equal(localBaseUrl("::1", 17300), "http://[::1]:17300");
    assert.equal(localBaseUrl("192.168.1.20", 17300), "http://192.168.1.20:17300");
  });
  it(".env 中的普通配置生效，并覆盖桌面端默认值", () => {
    const { env } = merge({}, { OA_PUBLIC_BASE_URL: "https://oa.lan.example", WEBHOOK_ALLOWED_HOSTS: "bot.lan", REDIS_URL: "redis://x" });
    assert.equal(env.OA_PUBLIC_BASE_URL, "https://oa.lan.example");
    assert.equal(env.WEBHOOK_ALLOWED_HOSTS, "bot.lan");
    assert.equal(env.REDIS_URL, "redis://x");
  });
  it("进程环境变量优先于 .env 与默认值（不写入，保留原值）", () => {
    const { env } = merge(
      { OA_PUBLIC_BASE_URL: "https://from-process.example", WEBHOOK_ALLOWED_HOSTS: "proc.lan" },
      { OA_PUBLIC_BASE_URL: "https://from-file.example", WEBHOOK_ALLOWED_HOSTS: "file.lan" },
    );
    assert.equal("OA_PUBLIC_BASE_URL" in env, false);
    assert.equal("WEBHOOK_ALLOWED_HOSTS" in env, false);
  });
  it("空字符串视为未配置，仍会应用 .env 或默认值", () => {
    assert.equal(merge({ OA_PUBLIC_BASE_URL: "" }).env.OA_PUBLIC_BASE_URL, "http://127.0.0.1:17300");
    assert.equal(merge({ OA_PUBLIC_BASE_URL: " " }, { OA_PUBLIC_BASE_URL: "https://f.example" }).env.OA_PUBLIC_BASE_URL, "https://f.example");
    assert.equal(merge({}, { OA_PUBLIC_BASE_URL: "" }).env.OA_PUBLIC_BASE_URL, "http://127.0.0.1:17300");
  });
  it("尊重显式的 WEBHOOK_ALLOW_PRIVATE_NETWORK=false（.env 或进程环境变量）", () => {
    assert.equal(merge({}, { WEBHOOK_ALLOW_PRIVATE_NETWORK: "false" }).env.WEBHOOK_ALLOW_PRIVATE_NETWORK, "false");
    const fromProcess = merge({ WEBHOOK_ALLOW_PRIVATE_NETWORK: "false" }, { WEBHOOK_ALLOW_PRIVATE_NETWORK: "true" });
    assert.equal("WEBHOOK_ALLOW_PRIVATE_NETWORK" in fromProcess.env, false);
  });
  it(".env 不能覆盖管理键与壳传入的启动参数（大小写不敏感），并报告被忽略的键", () => {
    const fileEnv = {
      NODE_ENV: "development",
      DATABASE_URL: "file:./evil.db",
      AUTH_SECRET: "evil",
      COLLAB_PORT: "1",
      port: "2",
      node_env: "development",
      OA_DATA_DIR: "C:/evil",
      OA_PORT: "80",
      OA_BIND: "0.0.0.0",
      OA_CONTROL_TOKEN: "evil",
      OA_MIGRATIONS_DIR: "C:/evil",
      SAFE_KEY: "ok",
    };
    const { env, ignored } = merge({ OA_DATA_DIR: "C:/data", OA_PORT: "17300", OA_BIND: "127.0.0.1", OA_CONTROL_TOKEN: "t" }, fileEnv);
    for (const [k, v] of Object.entries(managed)) assert.equal(env[k], v);
    for (const k of [...SHELL_KEYS, "port", "node_env"]) assert.equal(k in env, false, k);
    assert.equal(env.SAFE_KEY, "ok");
    assert.deepEqual(ignored.sort(), Object.keys(fileEnv).filter((k) => k !== "SAFE_KEY").sort());
  });
  it("管理键始终以桌面端计算值为准，即使进程环境变量中已存在", () => {
    const { env } = merge({ NODE_ENV: "development", DATABASE_URL: "file:./other.db" });
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.DATABASE_URL, managed.DATABASE_URL);
  });
});
