import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { WebSocket, WebSocketServer } from "ws";
import { startGateway } from "../../server/desktop/gateway";
import { migrate } from "../../server/desktop/migrate";
import {
  buildStandaloneRuntimeEnv,
  parseSqliteFilePath,
  resolveAuthSecret,
  resolveStandaloneConfig,
} from "../../server/standalone/env";
import { makeStorageKey } from "../../src/lib/storage";
import { LocalStorageDriver } from "../../src/lib/storage/local";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "desktop/migrations");

function mkTmp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function listenServer(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") reject(new Error("无法获取端口"));
      else resolve(addr.port);
    });
  });
}

describe("standalone 环境变量解析与密钥管理", () => {
  it("parseSqliteFilePath 解析绝对/相对 file: 路径并拒绝非法连接串", () => {
    assert.equal(parseSqliteFilePath("file:/data/db/oa.db"), "/data/db/oa.db");
    assert.equal(parseSqliteFilePath("file:/data/db/oa.db?mode=rwc"), "/data/db/oa.db");
    const cwd = path.resolve("/tmp/oa-test");
    assert.equal(parseSqliteFilePath("file:./prisma/dev.db", cwd), path.resolve(cwd, "./prisma/dev.db"));
    assert.throws(() => parseSqliteFilePath("postgresql://localhost/oa"), /SQLite/);
    assert.throws(() => parseSqliteFilePath("file::memory:"), /内存库/);
  });

  it("resolveStandaloneConfig 默认按 OA_DATA_DIR 派生 3 个持久化目录并尊重显式覆盖", () => {
    const appDir = path.resolve("/app");
    const cwd = path.resolve("/app");
    const def = resolveStandaloneConfig({}, appDir, cwd);
    assert.equal(def.port, 3000);
    assert.equal(def.bind, "0.0.0.0");
    assert.equal(def.dbFile, path.join(def.dataDir, "db", "oa.db"));
    assert.equal(def.backupDir, path.join(def.dataDir, "db", "backups"));
    assert.equal(def.attachmentDir, path.join(def.dataDir, "attachments"));
    assert.equal(def.storageLocalDir, path.join(def.dataDir, "uploads"));
    assert.equal(def.storageDriver, "local");
    assert.equal(def.migrationsDir, path.join(appDir, "migrations"));

    const custom = resolveStandaloneConfig(
      {
        OA_PORT: "8080",
        OA_BIND: "127.0.0.1",
        DATABASE_URL: "file:/custom/sqlite/my.db",
        ATTACHMENT_DIR: "/vol2/att",
        STORAGE_LOCAL_DIR: "/vol2/upl",
        S3_BUCKET: "oa-bucket",
      },
      appDir,
      cwd,
    );
    assert.equal(custom.port, 8080);
    assert.equal(custom.bind, "127.0.0.1");
    assert.equal(custom.dbFile, "/custom/sqlite/my.db");
    assert.equal(custom.backupDir, path.resolve(cwd, path.join(path.dirname("/custom/sqlite/my.db"), "backups")));
    assert.equal(custom.attachmentDir, path.resolve(cwd, "/vol2/att"));
    assert.equal(custom.storageDriver, "s3");

    assert.throws(() => resolveStandaloneConfig({ OA_PORT: "99999" }, appDir, cwd), /无效的监听端口/);
  });

  it("resolveAuthSecret：环境变量优先 → 复用已有 secret.key → 自动生成并持久化", () => {
    const dir = mkTmp("oa-secret-");
    try {
      const secretFile = path.join(dir, "db", "secret.key");
      const gen = resolveAuthSecret(undefined, secretFile);
      assert.equal(gen.source, "generated");
      assert.ok(gen.secret.length >= 48);
      assert.equal(fs.readFileSync(secretFile, "utf8"), gen.secret);

      const reused = resolveAuthSecret("", secretFile);
      assert.equal(reused.source, "file");
      assert.equal(reused.secret, gen.secret);

      const fromEnv = resolveAuthSecret("explicit-env-secret-0123456789abcdef", secretFile);
      assert.equal(fromEnv.source, "env");
      assert.equal(fromEnv.secret, "explicit-env-secret-0123456789abcdef");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildStandaloneRuntimeEnv 绑定内部服务到 127.0.0.1 并默认使用同源 /collab 与 /rt", () => {
    const cfg = resolveStandaloneConfig({ OA_DATA_DIR: "/data" }, "/app", "/app");
    const env = buildStandaloneRuntimeEnv(cfg, { nextPort: 40001, collabPort: 40002, rtPort: 40003 }, "sec", {});
    assert.equal(env.HOSTNAME, "127.0.0.1");
    assert.equal(env.COLLAB_HOST, "127.0.0.1");
    assert.equal(env.REALTIME_HOST, "127.0.0.1");
    assert.equal(env.PORT, "40001");
    assert.equal(env.COLLAB_PORT, "40002");
    assert.equal(env.REALTIME_PORT, "40003");
    assert.equal(env.COLLAB_PUBLIC_URL, "/collab");
    assert.equal(env.REALTIME_PUBLIC_URL, "/rt");
    assert.equal(env.COLLAB_HTTP_URL, "http://127.0.0.1:40002");
    assert.equal(env.REALTIME_INTERNAL_URL, "http://127.0.0.1:40003");
  });
});

describe("SQLite migrate：空库初始化、WAL、增量备份与 CLI 已有库基线兼容", () => {
  it("空库执行全部迁移、开启 WAL，且再次执行幂等", () => {
    const dir = mkTmp("oa-mig-empty-");
    try {
      const dbFile = path.join(dir, "db", "oa.db");
      const backupDir = path.join(dir, "db", "backups");
      const applied = migrate(dbFile, MIGRATIONS_DIR, backupDir);
      assert.ok(applied.length >= 4);
      assert.equal(applied[0], "0001_init.sql");

      const db = new Database(dbFile, { readonly: true });
      try {
        assert.equal(String(db.pragma("journal_mode", { simple: true })).toLowerCase(), "wal");
        const count = db.prepare("SELECT COUNT(*) FROM _oa_migrations").pluck().get() as number;
        assert.equal(count, applied.length);
      } finally {
        db.close();
      }

      // 第二次执行应无待迁移文件，且空库首次建表不会产生无意义的备份
      assert.deepEqual(migrate(dbFile, MIGRATIONS_DIR, backupDir), []);
      assert.equal(fs.existsSync(backupDir), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("迁移来自命令行 prisma db push 的最新库（无 _oa_migrations）：自动基线登记且保留业务数据", () => {
    const dir = mkTmp("oa-mig-cli-latest-");
    try {
      const dbFile = path.join(dir, "oa.db");
      const backupDir = path.join(dir, "backups");
      const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => /^\d{4}_.+\.sql$/.test(f))
        .sort();

      // 模拟 prisma db push 创建的完整库：执行全部 DDL 但不建 _oa_migrations，并写入一条 Role 数据
      const seed = new Database(dbFile);
      seed.pragma("foreign_keys = OFF");
      for (const f of files) seed.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
      seed.prepare("INSERT INTO Role (id, key, name) VALUES ('r1', 'admin', '管理员')").run();
      seed.close();

      const applied = migrate(dbFile, MIGRATIONS_DIR, backupDir);
      assert.deepEqual(applied, []);

      const check = new Database(dbFile, { readonly: true });
      try {
        assert.equal(String(check.pragma("journal_mode", { simple: true })).toLowerCase(), "wal");
        assert.equal(check.prepare("SELECT COUNT(*) FROM _oa_migrations").pluck().get(), files.length);
        assert.equal(check.prepare("SELECT name FROM Role WHERE id = 'r1'").pluck().get(), "管理员");
      } finally {
        check.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("迁移来自旧版 CLI 库（仅含 0001..0003 表结构）：自动基线 0001..0003、先备份再补齐 0004", () => {
    const dir = mkTmp("oa-mig-cli-older-");
    try {
      const dbFile = path.join(dir, "oa.db");
      const backupDir = path.join(dir, "backups");
      const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => /^\d{4}_.+\.sql$/.test(f))
        .sort();
      assert.ok(files.length >= 4);

      const seed = new Database(dbFile);
      seed.pragma("foreign_keys = OFF");
      for (const f of files.slice(0, 3)) seed.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
      seed.prepare("INSERT INTO Role (id, key, name) VALUES ('r1', 'member', '成员')").run();
      seed.close();

      const applied = migrate(dbFile, MIGRATIONS_DIR, backupDir);
      assert.deepEqual(applied, files.slice(3));

      // 升级前应自动生成 VACUUM INTO 备份文件
      const backups = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db"));
      assert.equal(backups.length, 1);

      const check = new Database(dbFile, { readonly: true });
      try {
        assert.equal(check.prepare("SELECT COUNT(*) FROM _oa_migrations").pluck().get(), files.length);
        assert.equal(check.prepare("SELECT name FROM Role WHERE id = 'r1'").pluck().get(), "成员");
        const tables = check
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'WebhookConnector'")
          .pluck()
          .all();
        assert.deepEqual(tables, ["WebhookConnector"]);
      } finally {
        check.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("遇到结构不匹配的陌生 SQLite 库时拒绝执行以保护数据", () => {
    const dir = mkTmp("oa-mig-unknown-");
    try {
      const dbFile = path.join(dir, "other.db");
      const seed = new Database(dbFile);
      seed.exec("CREATE TABLE unrelated_app (id INTEGER PRIMARY KEY, val TEXT)");
      seed.close();

      assert.throws(() => migrate(dbFile, MIGRATIONS_DIR, path.join(dir, "backups")), /结构与当前迁移历史不匹配/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("单端口网关：反代头透传、/health 探活、禁用控制面与 WS 路由", () => {
  it("透传 X-Forwarded-Proto/Host，暴露 /health，关闭 /__oa/* 并正确分流 /collab 与 /rt WebSocket", async () => {
    const receivedHeaders: http.IncomingHttpHeaders[] = [];
    const nextSrv = http.createServer((req, res) => {
      receivedHeaders.push(req.headers);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: req.url, proto: req.headers["x-forwarded-proto"], host: req.headers["x-forwarded-host"] }));
    });
    const collabSrv = http.createServer((_req, res) => res.end("ok"));
    const collabWss = new WebSocketServer({ server: collabSrv });
    collabWss.on("connection", (ws, req) => {
      ws.send(`collab:${req.url}`);
      ws.close();
    });

    const rtSrv = http.createServer((_req, res) => res.end("ok"));
    const rtWss = new WebSocketServer({ server: rtSrv });
    rtWss.on("connection", (ws, req) => {
      ws.send(`rt:${req.url}`);
      ws.close();
    });

    const [nextPort, collabPort, rtPort] = await Promise.all([listenServer(nextSrv), listenServer(collabSrv), listenServer(rtSrv)]);
    const gwPort = await (async () => {
      const probe = http.createServer();
      const p = await listenServer(probe);
      await new Promise((r) => probe.close(r));
      return p;
    })();

    const gw = await startGateway({
      port: gwPort,
      host: "127.0.0.1",
      nextPort,
      collabPort,
      rtPort,
      enableControl: false,
      healthCheck: async () => ({ ok: true, services: { next: true, collab: true, realtime: true } }),
    });

    try {
      // 1) /health 探活
      const healthRes = await fetch(`http://127.0.0.1:${gwPort}/health`);
      assert.equal(healthRes.status, 200);
      assert.deepEqual(await healthRes.json(), { ok: true, services: { next: true, collab: true, realtime: true } });

      // 2) 直连时默认 x-forwarded-proto=http；有反代头时原样透传 https 与域名
      const direct = (await (await fetch(`http://127.0.0.1:${gwPort}/ping`)).json()) as { proto: string; host: string };
      assert.equal(direct.proto, "http");
      assert.equal(direct.host, `127.0.0.1:${gwPort}`);

      const proxied = (await (
        await fetch(`http://127.0.0.1:${gwPort}/ping`, {
          headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "oa.example.com" },
        })
      ).json()) as { proto: string; host: string };
      assert.equal(proxied.proto, "https");
      assert.equal(proxied.host, "oa.example.com");

      // 3) enableControl=false 时 /__oa/health 不再由网关拦截，直接交给 Next（不会暴露宿主机网卡地址）
      const ctrl = (await (await fetch(`http://127.0.0.1:${gwPort}/__oa/health`)).json()) as { url?: string };
      assert.equal(ctrl.url, "/__oa/health");

      // 4) WebSocket /collab 与 /rt 分流并去掉前缀保留 query
      const readWs = (url: string) =>
        new Promise<string>((resolve, reject) => {
          const ws = new WebSocket(url);
          ws.once("message", (d) => resolve(String(d)));
          ws.once("error", reject);
        });
      assert.equal(await readWs(`ws://127.0.0.1:${gwPort}/collab?doc=abc`), "collab:/?doc=abc");
      assert.equal(await readWs(`ws://127.0.0.1:${gwPort}/rt?token=xyz`), "rt:/?token=xyz");
    } finally {
      gw.close();
      collabWss.close();
      rtWss.close();
      await Promise.all([
        new Promise((r) => nextSrv.close(r)),
        new Promise((r) => collabSrv.close(r)),
        new Promise((r) => rtSrv.close(r)),
      ]);
    }
  });
});

describe("附件存储路径跨平台兼容（Windows → Linux）", () => {
  it("makeStorageKey 恒用正斜杠；LocalStorageDriver 兼容含反斜杠的历史 key 且拦截路径穿越", async () => {
    const key = makeStorageKey("im", "报告.png");
    assert.match(key, /^im\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    assert.equal(key.includes("\\"), false);

    const dir = mkTmp("oa-storage-compat-");
    try {
      const driver = new LocalStorageDriver(dir);
      const payload = new TextEncoder().encode("hello-nas");
      await driver.put("im/2026/11/sample.txt", payload);

      // 正斜杠、Windows 反斜杠、带前导反斜杠均可正确定位同一文件
      for (const k of ["im/2026/11/sample.txt", "im\\2026\\11\\sample.txt", "\\im\\2026\\11\\sample.txt"]) {
        const obj = await driver.get(k);
        assert.ok(obj, `应读取到 ${k}`);
        assert.equal(new TextDecoder().decode(obj.data), "hello-nas");
      }

      await assert.rejects(() => driver.get("..\\secret.key"), /非法的存储路径/);
      await assert.rejects(() => driver.get("im/../../secret.key"), /非法的存储路径/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
