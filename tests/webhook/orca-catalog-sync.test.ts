import "./setup-db";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { createWebhookBot, setWebhookBotEnabled } from "@/lib/im/webhook-admin";
import { buildOrcaCatalog, parseCatalogRows as serverParseRows, type CatalogReadResult, type CatalogRow, type CliResult } from "@/lib/im/orca-catalog";
import { SYNC_GUIDE, modelChoices, originText } from "@/lib/im/orca-catalog-shared";
import {
  MAX_SYNC_BODY_BYTES,
  MAX_SYNC_HOSTS,
  SYNC_TOKEN_PREFIX,
  applyCustomModels,
  authenticateSyncToken,
  catalogToSnapshot,
  deleteCustomModel,
  deleteSnapshot,
  getSyncKeyInfo,
  handleCatalogSync,
  listCustomModels,
  loadSnapshots,
  parseSnapshot,
  resolveOrcaCatalog,
  revealSyncKey,
  rotateSyncKey,
  saveSnapshot,
  upsertCustomModel,
  type SessionAuth,
} from "@/lib/im/orca-catalog-sync";
import * as script from "../../scripts/orca/sync-catalog.mjs";

const root = path.resolve(__dirname, "../..");
const SCRIPT = path.join(root, "scripts/orca/sync-catalog.mjs");

const record = (agent: string, extra: Record<string, unknown>) => JSON.stringify({ agent, fingerprint: "f", ...extra });
const row = (key: string, seq: number, value: string): CatalogRow => ({ key, seq, value });

/** 模拟 Orca 模型目录 rows 表（含需要被过滤的脏数据） */
const ROWS: CatalogRow[] = [
  row("claude\0old", 1, record("claude", { discovered: { models: [{ id: "claude-old" }] } })),
  row(
    "claude\0new",
    5,
    record("claude", {
      discovered: {
        models: [
          { id: "claude-opus-5-5", label: "Opus 5.5", description: "复杂任务", isDefault: true, efforts: [{ value: "low", label: "Low" }, { value: "MAX", label: "Max" }], defaultEffort: "max" },
          { id: "claude-haiku-5-5", label: "Haiku 5.5", efforts: [], effortsKnown: true },
          { id: "has space" },
        ],
      },
      configured: { modelId: "claude-opus-5-5", effort: "max" },
    }),
  ),
  row("codex\0a", 3, record("codex", { live: { models: [{ id: "gpt-6-astra", efforts: ["low", "high", "very high"] }] }, discovered: { models: [{ id: "gpt-old" }] } })),
  row("droid\0b", 9, "{broken"),
  row("droid\0a", 2, JSON.stringify({ discovered: { models: [{ id: "glm-5" }, { id: "glm-5" }, { id: "openai/gpt-5.5:high" }] } })),
];
const INSTALLED = { agents: [{ id: "codex", name: "Codex", isDefault: true }, { id: "claude", name: "Claude Code", isDefault: false }, { id: "dsh", name: "DSH", isDefault: false }] };

function snapshotBody(host = "office-pc", extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    source: { host, label: "办公室电脑", platform: "win32", generator: "test" },
    defaultAgent: "codex",
    agents: [
      { id: "codex", name: "Codex", installed: true, isDefault: true, modelSource: "live", models: [{ id: "gpt-6-astra", efforts: [{ value: "low" }, { value: "high" }] }] },
      { id: "claude", name: "Claude Code", installed: true, models: [{ id: "claude-opus-5-5", label: "Opus 5.5", isDefault: true }, { id: "claude-haiku-5-5", effortsKnown: true }] },
      { id: "dsh", installed: true, models: [] },
    ],
    ...extra,
  };
}

const cliOk: CliResult = { status: "ok", installed: INSTALLED };
const cliNone: CliResult = { status: "disabled" };
const localMissing: CatalogReadResult = { status: "missing", agents: new Map() };

async function resetTables() {
  await db.orcaCatalogSnapshot.deleteMany();
  await db.orcaCustomModel.deleteMany();
  await db.orcaCatalogSyncKey.deleteMany();
}

function syncRequest(body: unknown, opts: { token?: string; header?: "bearer" | "x-oa"; origin?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) {
    if (opts.header === "x-oa") headers["X-OA-Catalog-Token"] = opts.token;
    else headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.origin) headers.Origin = opts.origin;
  return new Request("http://oa.test/api/im/webhooks/orca-catalog/sync", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
}

const noSession = async (): Promise<SessionAuth> => null;
const admin = async (): Promise<SessionAuth> => ({ id: "u-admin", isAdmin: true });
const member = async (): Promise<SessionAuth> => ({ id: "u-member", isAdmin: false });

let userId = "";

before(async () => {
  const role = await db.role.create({ data: { key: "member", name: "成员", permissions: "[]" } });
  userId = (await db.user.create({ data: { email: "admin@test.local", name: "Admin", passwordHash: "x", roleId: role.id } })).id;
});

after(async () => {
  await db.$disconnect();
});

describe("快照 Schema（严格校验）", () => {
  it("合法快照通过并规范化：主机名小写、默认基座唯一、计数正确", async () => {
    await resetTables();
    const r = parseSnapshot({ ...snapshotBody("Office-PC"), agents: [...snapshotBody().agents.map((a) => ({ ...a, isDefault: true }))] });
    assert.ok(r.ok);
    const saved = await saveSnapshot(db, r.data, "token");
    assert.deepEqual([saved.host, saved.agentCount, saved.modelCount], ["office-pc", 3, 3]);
    const [s] = await loadSnapshots(db);
    assert.deepEqual(s.agents.map((a) => [a.id, a.isDefault]), [["codex", true], ["claude", false], ["dsh", false]]);
    assert.deepEqual(s.agents[0].models[0], {
      id: "gpt-6-astra",
      label: "gpt-6-astra",
      description: null,
      isDefault: false,
      efforts: [{ value: "low", label: "low" }, { value: "high", label: "high" }],
      effortsKnown: true,
      defaultEffort: null,
    });
    assert.equal(s.agents[2].modelSource, null);
  });
  it("拒绝未知字段、错误版本、非法 ID、重复项，并给出中文字段路径", () => {
    const cases: [unknown, RegExp][] = [
      [{ ...snapshotBody(), extra: 1 }, /不支持的字段：extra/],
      [{ ...snapshotBody(), version: 2 }, /version: 1/],
      [snapshotBody("bad host"), /source\.host：主机名只能包含/],
      [{ ...snapshotBody(), agents: [{ id: "Codex!", models: [] }] }, /agents\[0\]\.id：基座标识只能包含/],
      [{ ...snapshotBody(), agents: [{ id: "codex", models: [{ id: "has space" }] }] }, /agents\[0\]\.models\[0\]\.id：模型 ID 只能包含/],
      [{ ...snapshotBody(), agents: [{ id: "codex", models: [{ id: "m", efforts: [{ value: "very high" }] }] }] }, /思考强度只能是/],
      [{ ...snapshotBody(), agents: [{ id: "codex", models: [] }, { id: "codex", models: [] }] }, /基座 codex 重复/],
      [{ ...snapshotBody(), agents: [{ id: "codex", models: [{ id: "m" }, { id: "m" }] }] }, /模型 m 重复/],
      [{ ...snapshotBody(), agents: [{ id: "codex", models: Array.from({ length: 501 }, (_, i) => ({ id: `m${i}` })) }] }, /最多 500 个模型/],
      [{ ...snapshotBody(), agents: [{ id: "codex", models: [{ id: "m", sneaky: true }] }] }, /不支持的字段：sneaky/],
      [{ version: 1, agents: [] }, /source/],
    ];
    for (const [input, re] of cases) {
      const r = parseSnapshot(input);
      assert.equal(r.ok, false, JSON.stringify(input).slice(0, 80));
      assert.match((r as { error: string }).error, re);
    }
  });
});

describe("同步密钥", () => {
  beforeEach(resetTables);
  it("生成 / 查看 / 重置：只存哈希与密文，重置后旧密钥立即失效", async () => {
    assert.deepEqual(await getSyncKeyInfo(db), { exists: false, prefix: null, createdAt: null, lastUsedAt: null });
    const t1 = await rotateSyncKey(db, userId);
    assert.ok(t1.startsWith(SYNC_TOKEN_PREFIX) && t1.length > 30);
    const stored = await db.orcaCatalogSyncKey.findUniqueOrThrow({ where: { id: "default" } });
    assert.ok(!stored.tokenHash.includes(t1) && !stored.tokenCipher.includes(t1));
    assert.equal(await revealSyncKey(db), t1);
    const info = await getSyncKeyInfo(db);
    assert.equal(info.prefix, t1.slice(0, SYNC_TOKEN_PREFIX.length + 6));
    assert.equal(info.lastUsedAt, null);

    assert.deepEqual(await authenticateSyncToken(db, t1), { kind: "sync-key" });
    assert.ok((await getSyncKeyInfo(db)).lastUsedAt);

    const t2 = await rotateSyncKey(db, userId);
    assert.notEqual(t1, t2);
    assert.equal(await authenticateSyncToken(db, t1), null);
    assert.deepEqual(await authenticateSyncToken(db, t2), { kind: "sync-key" });
    assert.equal(await authenticateSyncToken(db, ""), null);
    assert.equal(await authenticateSyncToken(db, "x".repeat(500)), null);
  });
});

describe("POST /api/im/webhooks/orca-catalog/sync", () => {
  let token = "";
  let bot: { connectorId: string; botUserId: string; token: string };
  before(async () => {
    bot = await db.$transaction((tx) => createWebhookBot(tx, userId, { name: "Orca 同步", avatarColor: "#9065b0", outboundUrl: "http://127.0.0.1:9/hook", triggerMode: "mention_only" }));
  });
  beforeEach(async () => {
    await resetTables();
    token = await rotateSyncKey(db, userId);
  });

  it("同步密钥（Bearer / X-OA-Catalog-Token）推送成功，返回计数与同步时间，并持久化", async () => {
    let saved = 0;
    const now = new Date("2026-11-28T07:00:00Z");
    const res = await handleCatalogSync(syncRequest(snapshotBody("Office-PC"), { token }), { client: db, session: noSession, onSaved: () => saved++, now: () => now });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body, { ok: true, via: "token", host: "office-pc", label: "办公室电脑", agentCount: 3, modelCount: 3, syncedAt: now.toISOString(), unchanged: false, customModelCount: 0 });
    assert.equal(saved, 1);

    const res2 = await handleCatalogSync(syncRequest(snapshotBody("office-pc"), { token, header: "x-oa" }), { client: db, session: noSession });
    assert.equal(res2.status, 200);
    assert.equal((await res2.json()).unchanged, true);
    const snaps = await loadSnapshots(db);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].via, "token");
    assert.deepEqual(snaps[0].agents.map((a) => [a.id, a.isDefault, a.models.length]), [["codex", true, 1], ["claude", false, 2], ["dsh", false, 0]]);
  });

  it("已启用 Webhook 机器人的回调 Token 也可推送；机器人停用后拒绝", async () => {
    const ok = await handleCatalogSync(syncRequest(snapshotBody(), { token: bot.token }), { client: db, session: noSession });
    assert.equal(ok.status, 200);
    await db.$transaction((tx) => setWebhookBotEnabled(tx, bot.connectorId, false));
    try {
      const denied = await handleCatalogSync(syncRequest(snapshotBody(), { token: bot.token }), { client: db, session: noSession });
      assert.equal(denied.status, 401);
    } finally {
      await db.$transaction((tx) => setWebhookBotEnabled(tx, bot.connectorId, true));
    }
  });

  it("鉴权失败：无凭据 401、错误密钥 401（不回退到会话）、普通成员 403、跨站会话 403；管理员同源会话可导入", async () => {
    const cases: [Request, () => Promise<SessionAuth>, number, RegExp][] = [
      [syncRequest(snapshotBody()), noSession, 401, /缺少同步密钥/],
      [syncRequest(snapshotBody(), { token: "oacat_wrong" }), admin, 401, /同步密钥无效/],
      [syncRequest(snapshotBody()), member, 403, /仅管理员/],
      [syncRequest(snapshotBody(), { origin: "http://evil.test" }), admin, 403, /跨站/],
    ];
    for (const [req, session, status, re] of cases) {
      const res = await handleCatalogSync(req, { client: db, session });
      assert.equal(res.status, status);
      assert.match((await res.json()).error, re);
    }
    assert.equal(await db.orcaCatalogSnapshot.count(), 0);
    const res = await handleCatalogSync(syncRequest(snapshotBody(), { origin: "http://oa.test" }), { client: db, session: admin });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).via, "session");
  });

  it("请求体限制：Content-Length 超限、流式超限均 413；非法 JSON / Schema 错误 400", async () => {
    const big = JSON.stringify({ ...snapshotBody(), pad: "x".repeat(MAX_SYNC_BODY_BYTES) });
    const r1 = await handleCatalogSync(syncRequest(null, { token, raw: big }), { client: db, session: noSession });
    assert.equal(r1.status, 413);

    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ > 20) c.close();
        else c.enqueue(chunk);
      },
    });
    const streamed = new Request("http://oa.test/api/im/webhooks/orca-catalog/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: stream,
      duplex: "half",
    } as RequestInit);
    assert.equal(streamed.headers.get("content-length"), null);
    const r2 = await handleCatalogSync(streamed, { client: db, session: noSession });
    assert.equal(r2.status, 413);
    assert.ok(sent < 20, "超限后应停止读取");

    const r3 = await handleCatalogSync(syncRequest(null, { token, raw: "{nope" }), { client: db, session: noSession });
    assert.equal(r3.status, 400);
    assert.match((await r3.json()).error, /不是合法的 JSON/);
    const r4 = await handleCatalogSync(syncRequest({ ...snapshotBody(), agents: [{ id: "codex", models: [{ id: "a b" }] }] }, { token }), { client: db, session: noSession });
    assert.equal(r4.status, 400);
    assert.match((await r4.json()).error, /agents\[0\]\.models\[0\]\.id/);
    assert.equal(await db.orcaCatalogSnapshot.count(), 0);
  });
});

describe("快照持久化与多主机", () => {
  beforeEach(resetTables);
  it("同一主机覆盖、最多保留 MAX_SYNC_HOSTS 台（删除最久未同步的），损坏的记录被跳过", async () => {
    const base = Date.parse("2026-11-01T00:00:00Z");
    for (let i = 0; i < MAX_SYNC_HOSTS + 2; i++) {
      const p = parseSnapshot(snapshotBody(`host-${i}`));
      assert.ok(p.ok);
      await saveSnapshot(db, p.data, "token", new Date(base + i * 60_000));
    }
    const hosts = (await loadSnapshots(db)).map((s) => s.host);
    assert.equal(hosts.length, MAX_SYNC_HOSTS);
    assert.ok(!hosts.includes("host-0") && !hosts.includes("host-1"));
    assert.equal(hosts[0], `host-${MAX_SYNC_HOSTS + 1}`);

    await db.orcaCatalogSnapshot.update({ where: { sourceHost: "host-5" }, data: { payload: "{broken" } });
    assert.equal((await loadSnapshots(db)).length, MAX_SYNC_HOSTS - 1);
    await deleteSnapshot(db, "HOST-6");
    assert.equal(await db.orcaCatalogSnapshot.count(), MAX_SYNC_HOSTS - 1);
  });
});

describe("自定义模型", () => {
  beforeEach(resetTables);
  it("校验、去重、按基座 + 模型 ID 更新；Push 同步不影响自定义模型", async () => {
    await assert.rejects(upsertCustomModel(db, { agent: "", modelId: "m" }, userId), /请填写基座标识/);
    await assert.rejects(upsertCustomModel(db, { agent: "claude", modelId: "bad id" }, userId), /模型 ID 只能包含/);
    await assert.rejects(upsertCustomModel(db, { agent: "claude", modelId: "m", efforts: ["low"], defaultEffort: "high" }, userId), /默认思考强度需在/);

    const a = await upsertCustomModel(db, { agent: " Claude ", modelId: " claude-opus-6 ", label: "Opus 6", efforts: ["LOW", "high", "high"], defaultEffort: "HIGH" }, userId);
    assert.deepEqual([a.agent, a.modelId, a.efforts, a.defaultEffort], ["claude", "claude-opus-6", ["low", "high"], "high"]);
    const b = await upsertCustomModel(db, { agent: "claude", modelId: "claude-opus-6", label: "Opus 6（新）" }, userId);
    assert.equal(b.id, a.id);
    await upsertCustomModel(db, { agent: "kimi", modelId: "kimi-k3" }, userId);
    assert.equal((await listCustomModels(db)).length, 2);

    const token = await rotateSyncKey(db, userId);
    for (let i = 0; i < 2; i++) {
      const res = await handleCatalogSync(syncRequest(snapshotBody(), { token }), { client: db, session: noSession });
      assert.equal((await res.json()).customModelCount, 2);
    }
    const list = await listCustomModels(db);
    assert.deepEqual(list.map((c) => [c.agent, c.modelId, c.label]), [["claude", "claude-opus-6", "Opus 6（新）"], ["kimi", "kimi-k3", null]]);
    await deleteCustomModel(db, list[1].id);
    assert.equal((await listCustomModels(db)).length, 1);
  });

  it("合并：自定义模型排在该基座最前；与同步模型同 ID 时沿用同步数据并标记；未知基座插在预设前", async () => {
    const p = parseSnapshot(snapshotBody());
    assert.ok(p.ok);
    await saveSnapshot(db, p.data, "token");
    const snaps = await loadSnapshots(db);
    const catalog = resolveOrcaCatalog({
      cli: cliNone,
      local: localMissing,
      snapshots: snaps,
      customs: [
        { id: "1", agent: "claude", modelId: "claude-opus-6", label: "Opus 6", efforts: ["low", "high"], defaultEffort: "high" },
        { id: "2", agent: "claude", modelId: "claude-haiku-5-5", label: null, efforts: [], defaultEffort: null },
        { id: "3", agent: "kimi", modelId: "kimi-k3", label: null, efforts: [], defaultEffort: null },
      ],
    });
    assert.equal(catalog.customModelCount, 3);
    const claude = catalog.agents.find((a) => a.id === "claude")!;
    assert.deepEqual(claude.models.map((m) => [m.id, !!m.custom]), [["claude-opus-6", true], ["claude-opus-5-5", false], ["claude-haiku-5-5", true]]);
    assert.deepEqual(claude.models[0].efforts.map((e) => e.value), ["low", "high"]);
    assert.equal(claude.models[0].defaultEffort, "high");
    const ids = catalog.agents.map((a) => a.id);
    assert.ok(ids.indexOf("kimi") > ids.indexOf("dsh") && ids.indexOf("kimi") < ids.indexOf("antigravity"), ids.join(","));
    const kimi = catalog.agents.find((a) => a.id === "kimi")!;
    assert.equal(kimi.modelSource, "custom");
    assert.deepEqual(modelChoices(catalog, "kimi").models.map((m) => m.id), ["kimi-k3"]);
    // 预设基座也可补充模型
    const preset = applyCustomModels(resolveOrcaCatalog({ cli: cliNone, local: localMissing, snapshots: [], customs: [] }), [
      { id: "4", agent: "devin", modelId: "devin-2", label: null, efforts: [], defaultEffort: null },
    ]);
    assert.deepEqual(modelChoices(preset, "devin"), { models: [preset.agents.find((a) => a.id === "devin")!.models[0]], source: "custom" });
  });
});

describe("目录来源优先级：本机 Orca → 已同步快照 → 预设", () => {
  beforeEach(resetTables);
  const local: CatalogReadResult = { status: "ok", agents: serverParseRows(ROWS), via: "direct" };

  it("本机 CLI 可用时实时读取本机（即使数据库中有快照）", async () => {
    const p = parseSnapshot(snapshotBody("nas-only"));
    assert.ok(p.ok);
    await saveSnapshot(db, p.data, "token");
    const c = resolveOrcaCatalog({ cli: cliOk, local, snapshots: await loadSnapshots(db), customs: [], localHost: "mimo" });
    assert.deepEqual(c.origin, { kind: "local", host: "mimo" });
    assert.equal(originText(c.origin), "来源：本机 Orca");
    assert.deepEqual(c.agents.find((a) => a.id === "droid")?.models.map((m) => m.id), ["glm-5", "openai/gpt-5.5:high"]);
  });

  it("无本机 CLI（ORCA_CATALOG_LOCAL=off / 容器）且有快照 → 已同步目录；多主机按同步时间合并", async () => {
    const a = parseSnapshot(snapshotBody("office-pc"));
    const b = parseSnapshot({
      ...snapshotBody("laptop"),
      source: { host: "laptop", label: null },
      defaultAgent: null,
      agents: [
        { id: "claude", installed: false, models: [{ id: "claude-only-on-laptop" }] },
        { id: "pi", installed: true, models: [{ id: "pi-1" }] },
      ],
    });
    assert.ok(a.ok && b.ok);
    await saveSnapshot(db, a.data, "token", new Date("2026-11-28T06:00:00Z"));
    await saveSnapshot(db, b.data, "token", new Date("2026-11-28T07:00:00Z"));
    const now = new Date("2026-11-28T07:05:00Z");
    const c = resolveOrcaCatalog({ cli: cliNone, local: localMissing, snapshots: await loadSnapshots(db), customs: [], now });
    assert.equal(c.origin.kind, "synced");
    assert.deepEqual(c.origin, { kind: "synced", host: "laptop", label: null, syncedAt: "2026-11-28T07:00:00.000Z", hostCount: 2 });
    assert.match(originText(c.origin, now.getTime()), /^来源：已同步目录（laptop 等 2 台 · .*，5 分钟前）$/);
    // 默认基座来自仍声明了默认的主机；claude 取最近一次同步中的模型，但已安装状态取任一主机
    assert.equal(c.defaultAgent, "codex");
    assert.equal(c.agents[0].id, "codex");
    const claude = c.agents.find((x) => x.id === "claude")!;
    assert.deepEqual(claude.models.map((m) => m.id), ["claude-only-on-laptop"]);
    assert.equal(claude.installed, true);
    assert.ok(c.agents.some((x) => x.id === "pi" && x.installed));
    assert.ok(c.agents.some((x) => x.id === "antigravity" && !x.installed), "预设保留");
    assert.deepEqual(c.warnings, []);
    // 超过 7 天未同步提示
    const stale = resolveOrcaCatalog({ cli: cliNone, local: localMissing, snapshots: await loadSnapshots(db), customs: [], now: new Date("2026-12-10T00:00:00Z") });
    assert.match(stale.warnings[0], /天未更新/);
  });

  it("都没有 → 常用预设 + 同步引导", () => {
    const c = resolveOrcaCatalog({ cli: { status: "unavailable" }, local: localMissing, snapshots: [], customs: [] });
    assert.deepEqual(c.origin, { kind: "preset" });
    assert.deepEqual(c.warnings, [SYNC_GUIDE]);
    assert.equal(modelChoices(c, "claude").source, "preset");
    const err = resolveOrcaCatalog({ cli: { status: "error", error: "boom" }, local: localMissing, snapshots: [], customs: [] });
    assert.deepEqual(err.warnings, ["调用 Orca CLI 失败，基座列表使用预设", SYNC_GUIDE]);
  });

  it("本机目录转快照后再读取，结果与本机目录一致（OA 与 Orca 同机时自动记录）", async () => {
    const localCatalog = buildOrcaCatalog(cliOk, local, new Date(), "MimoDesktop");
    const snap = catalogToSnapshot(localCatalog, "Mimo Desktop!", null);
    assert.ok(snap);
    assert.equal(snap.source.host, "Mimo-Desktop-");
    await saveSnapshot(db, snap, "local");
    const synced = resolveOrcaCatalog({ cli: cliNone, local: localMissing, snapshots: await loadSnapshots(db), customs: [] });
    for (const a of localCatalog.agents.filter((x) => x.installed || x.modelSource)) {
      const s = synced.agents.find((x) => x.id === a.id)!;
      assert.deepEqual([s.label, s.installed, s.isDefault, s.modelSource, s.models, s.configured], [a.label, a.installed, a.isDefault, a.modelSource, a.models, a.configured], a.id);
    }
    assert.equal(catalogToSnapshot(buildOrcaCatalog({ status: "unavailable" }, localMissing), "h", null), null);
  });
});

describe("scripts/orca/sync-catalog.mjs", () => {
  it("参数：命令行优先于环境变量，地址规范化，缺参数给出中文提示", () => {
    const o = script.parseArgs(["--url", "192.168.1.5:3001/", "--token=abc", "--label", "办公室", "--timeout", "5"], { OA_URL: "http://x", OA_CATALOG_TOKEN: "env" });
    assert.deepEqual([o.url, o.token, o.label, o.timeoutMs, o.dryRun], ["http://192.168.1.5:3001", "abc", "办公室", 5000, false]);
    assert.equal(script.parseArgs([], { OA_URL: "https://oa.example.com/base/", OA_CATALOG_TOKEN: "t" }).url, "https://oa.example.com/base");
    assert.equal(script.parseArgs(["--dry-run"], {}).dryRun, true);
    assert.equal(script.parseArgs(["--out", "a.json"], {}).out, "a.json");
    assert.throws(() => script.parseArgs([], {}), /请用 --url 指定 OA 地址/);
    assert.throws(() => script.parseArgs(["--url", "http://x"], {}), /请用 --token 提供同步密钥/);
    assert.throws(() => script.parseArgs(["--token"], {}), /--token 需要一个值/);
    assert.throws(() => script.parseArgs(["--bogus"], {}), /未知参数：--bogus/);
    assert.throws(() => script.parseArgs(["--dry-run", "--timeout", "0"], {}), /--timeout/);
    assert.equal(script.sanitizeHost("  My PC (家)  "), "My-PC");
    assert.equal(script.sanitizeHost("..."), "orca-host");
  });

  it("目录解析与 OA 服务端完全一致；生成的快照通过服务端 Schema", () => {
    const stats = { skipped: 0 };
    const fromScript = script.parseCatalogRows(ROWS, stats);
    const fromServer = serverParseRows(ROWS);
    assert.deepEqual(Object.fromEntries(fromScript), Object.fromEntries(fromServer));
    assert.equal(stats.skipped, 1);
    assert.deepEqual(script.parseInstalledAgents(JSON.stringify({ result: { agents: [{ id: "Codex", default: true }, { id: "bad id" }] } })), { agents: [{ id: "codex", name: null, isDefault: true }] });
    assert.equal(script.resolveCatalogPath({ APPDATA: "C:\\R" }, "win32", "C:\\U"), "C:\\R\\orca\\agent-model-catalog.db");

    const snap = script.buildSnapshot({ installed: INSTALLED, catalog: fromScript, host: "Mimo Desktop", label: "我的电脑", platform: "win32", now: new Date("2026-11-28T00:00:00Z") });
    assert.deepEqual(snap.agents.map((a: { id: string }) => a.id), ["codex", "claude", "dsh", "droid"]);
    assert.deepEqual(script.summarize(snap), { agents: 4, models: 5 });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
    // 快照中每个基座的模型与 OA 直接读取本机 Orca 的结果一致
    const direct = buildOrcaCatalog(cliOk, { status: "ok", agents: fromServer, via: "direct" });
    for (const a of direct.agents.filter((x) => x.installed || x.modelSource)) {
      const s = snap.agents.find((x: { id: string }) => x.id === a.id)!;
      assert.deepEqual([s.installed, s.isDefault, s.models], [a.installed, a.isDefault, a.models], a.id);
    }
  });

  it("超出上限的部分被截断，仍能通过服务端校验", () => {
    const many = new Map([["codex", { agent: "codex", source: "live", models: Array.from({ length: 600 }, (_, i) => ({ id: `m${i}`, label: "L".repeat(300), description: "D".repeat(2000), isDefault: false, efforts: [], effortsKnown: false, defaultEffort: null })), configured: null }]]);
    const snap = script.buildSnapshot({ installed: null, catalog: many, host: "h" });
    assert.equal(snap.agents[0].models.length, 500);
    assert.ok(parseSnapshot(snap).ok);
  });

  it("main：dry-run / 导出 / 推送成功 / 推送失败 / 没有数据 / 参数错误 的退出码与中文输出", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-orca-sync-main-"));
    try {
      const io = (extra: Record<string, unknown> = {}) => {
        const out: string[] = [];
        const err: string[] = [];
        return {
          out,
          err,
          io: {
            env: {},
            stdout: (s: string) => out.push(s),
            stderr: (s: string) => err.push(s),
            runOrca: async () => ({ status: "ok", installed: INSTALLED }),
            readCatalog: async () => ({ status: "ok", agents: script.parseCatalogRows(ROWS), skipped: 1 }),
            ...extra,
          },
        };
      };
      const dry = io();
      assert.equal(await script.main(["--dry-run", "--host", "pc1"], dry.io), 0);
      const dryText = dry.out.join("\n");
      assert.match(dryText, /主机：pc1/);
      assert.match(dryText, /Orca CLI：检测到 3 个基座（默认 codex）/);
      assert.match(dryText, /跳过 1 个 ID 不合法的模型/);
      assert.match(dryText, /汇总：4 个基座，5 个模型/);
      assert.match(dryText, /\[dry-run\] 未推送/);

      const file = path.join(dir, "nested", "orca-catalog.json");
      const exp = io();
      assert.equal(await script.main(["--out", file], exp.io), 0);
      assert.ok(parseSnapshot(JSON.parse(fs.readFileSync(file, "utf8"))).ok);

      let pushed: unknown = null;
      const push = io({
        push: async (url: string, token: string, snap: unknown) => {
          pushed = { url, token, snap };
          return { ok: true, status: 200, body: { agentCount: 4, modelCount: 5, customModelCount: 2, syncedAt: "2026-11-28T07:00:00Z" } };
        },
      });
      assert.equal(await script.main(["--url", "http://nas:3001", "--token", "secret-token"], push.io), 0);
      assert.equal((pushed as { url: string }).url, "http://nas:3001");
      const pushText = push.out.join("\n");
      assert.match(pushText, /推送到 http:\/\/nas:3001：成功（HTTP 200）· OA 已记录 4 个基座 \/ 5 个模型（另有 2 个手动维护的模型保持不变）/);
      assert.ok(!pushText.includes("secret-token"), "输出中不得包含密钥");

      const fail = io({ push: async () => ({ ok: false, status: 401, error: "同步密钥无效" }) });
      assert.equal(await script.main(["--url", "http://nas:3001", "--token", "t"], fail.io), 3);
      assert.match(fail.err.join("\n"), /失败（HTTP 401）：同步密钥无效/);

      const empty = io({ runOrca: async () => ({ status: "unavailable" }), readCatalog: async () => ({ status: "missing", agents: new Map(), skipped: 0 }) });
      assert.equal(await script.main(["--dry-run"], empty.io), 2);
      assert.match(empty.out.join("\n"), /未找到 orca 命令/);
      assert.match(empty.err.join("\n"), /没有读取到任何基座或模型/);

      const usage = io();
      assert.equal(await script.main(["--url", "http://x"], usage.io), 1);
      assert.match(usage.err.join("\n"), /请用 --token/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("真实进程：读取 WAL 中的 SQLite 目录并推送到 OA 同步接口", () => {
    let dir: string;
    let server: Server;
    let base = "";
    let writer: Database.Database;
    let catalogFile = "";
    before(async () => {
      await resetTables();
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-orca-sync-proc-"));
      catalogFile = path.join(dir, "agent-model-catalog.db");
      writer = new Database(catalogFile);
      writer.pragma("journal_mode = WAL");
      writer.pragma("wal_autocheckpoint = 0");
      writer.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE rows(key TEXT PRIMARY KEY, seq INTEGER NOT NULL, value TEXT NOT NULL)");
      const insert = writer.prepare("INSERT INTO rows(key, seq, value) VALUES (?, ?, ?)");
      for (const r of ROWS) insert.run(r.key, r.seq, r.value);

      server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const r = await handleCatalogSync(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: Buffer.concat(chunks) }), {
          client: db,
          session: noSession,
        });
        res.writeHead(r.status, { "Content-Type": "application/json" }).end(await r.text());
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(async () => {
      writer.close();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const runScript = (args: string[], env: Record<string, string> = {}) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, OA_URL: "", OA_CATALOG_TOKEN: "", ...env }, timeout: 30_000 }, (err, stdout, stderr) => {
          resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
        });
      });

    it("Orca 写连接打开、数据仍在 -wal 中：dry-run 读到全部基座，不修改目录文件", async () => {
      const before = fs.readFileSync(catalogFile);
      const r = await runScript(["--dry-run", "--catalog", catalogFile, "--orca", path.join(dir, "no-orca.exe"), "--host", "proc-pc"]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /未找到 orca 命令/);
      assert.match(r.stdout, /读取成功，3 个基座，跳过 1 个 ID 不合法的模型/);
      assert.match(r.stdout, /汇总：3 个基座，5 个模型/);
      assert.ok(!/ExperimentalWarning/.test(r.stderr), r.stderr);
      assert.deepEqual(fs.readFileSync(catalogFile), before);
    });

    it("推送：错误密钥退出码 3；正确密钥写入数据库，自定义模型保留", async () => {
      const token = await rotateSyncKey(db, userId);
      await upsertCustomModel(db, { agent: "claude", modelId: "claude-opus-6" }, userId);
      const bad = await runScript(["--url", base, "--token", "oacat_wrong", "--catalog", catalogFile, "--orca", path.join(dir, "no-orca.exe")]);
      assert.equal(bad.code, 3);
      assert.match(bad.stderr, /HTTP 401.*同步密钥无效/);

      const ok = await runScript(["--catalog", catalogFile, "--orca", path.join(dir, "no-orca.exe"), "--host", "proc-pc", "--label", "进程测试"], { OA_URL: base, OA_CATALOG_TOKEN: token });
      assert.equal(ok.code, 0, ok.stderr);
      assert.match(ok.stdout, /成功（HTTP 200）· OA 已记录 3 个基座 \/ 5 个模型（另有 1 个手动维护的模型保持不变）/);
      assert.ok(!ok.stdout.includes(token) && !ok.stderr.includes(token));
      const snaps = await loadSnapshots(db);
      assert.deepEqual(snaps.map((s) => [s.host, s.label, s.agentCount, s.modelCount]), [["proc-pc", "进程测试", 3, 5]]);
      assert.equal((await listCustomModels(db)).length, 1);
    });

    it("无法连接时给出中文提示，退出码 3", async () => {
      const r = await runScript(["--url", "http://127.0.0.1:9", "--token", "t", "--catalog", catalogFile, "--orca", path.join(dir, "no-orca.exe"), "--timeout", "5"]);
      assert.equal(r.code, 3);
      assert.match(r.stderr, /无法连接 http:\/\/127\.0\.0\.1:9\/api\/im\/webhooks\/orca-catalog\/sync/);
    });
  });
});
