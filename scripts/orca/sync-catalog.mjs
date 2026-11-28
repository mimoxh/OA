#!/usr/bin/env node
/**
 * 把本机 Orca 的基座 / 模型 / 思考强度目录同步到 OA（OA 部署在 NAS / Docker 容器中、读不到本机 Orca 时使用）。
 *
 * 零依赖单文件：Node 22.5+（内置 node:sqlite），可脱离 OA 仓库直接运行，也可放进 Orca 定时自动化。
 *   node sync-catalog.mjs --url http://192.168.124.220:3001 --token oacat_xxx [--label 办公室电脑]
 *   node sync-catalog.mjs --dry-run                  只读取并打印，不推送
 *   node sync-catalog.mjs --out orca-catalog.json    导出快照，可在 OA 设置页手动导入
 *
 * 只读：执行 `orca agent installed --json`，并以只读方式打开 Orca 的 agent-model-catalog.db（兼容 WAL 模式）。
 * 目录解析与 OA 服务端 src/lib/im/orca-catalog.ts 保持一致（tests/webhook/orca-catalog-sync.test.ts 校验两者结果相同）。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SCRIPT_VERSION = "1";
const GENERATOR = `oa-orca-sync/${SCRIPT_VERSION}`;

// 与 OA 出站校验一致（src/lib/im/webhook-run-config.ts）
const AGENT_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MODEL_RE = /^[A-Za-z0-9][\w.:/@+-]*$/;
const EFFORT_RE = /^[a-z][a-z0-9_-]{0,23}$/;
// 与服务端快照 Schema 上限一致（src/lib/im/orca-catalog-sync.ts）
const LIMITS = { agents: 64, modelsPerAgent: 500, efforts: 32, label: 200, description: 1000, effortLabel: 60, agentName: 80, sourceLabel: 60 };

const HELP = `用法：node sync-catalog.mjs [选项]

  --url <地址>        OA 访问地址，例如 http://192.168.124.220:3001（环境变量 OA_URL）
  --token <密钥>      Orca 目录同步密钥，在 OA「设置 · Webhook 机器人 · Orca 模型目录」中复制（环境变量 OA_CATALOG_TOKEN）
  --label <名称>      本机显示名称，例如「办公室电脑」（环境变量 OA_CATALOG_LABEL）
  --host <主机名>     来源主机标识（默认本机主机名；同一主机再次同步会覆盖上一次）
  --dry-run           只读取并打印目录，不推送
  --out <文件>        把快照导出为 JSON 文件（可在 OA 设置页手动导入）
  --catalog <路径>    Orca 模型目录路径（环境变量 ORCA_MODEL_CATALOG_PATH，默认 Orca 用户数据目录）
  --orca <路径>       orca 可执行文件路径（环境变量 ORCA_CLI_PATH，默认 PATH 中的 orca）
  --timeout <秒>      推送超时，默认 20 秒
  -h, --help          显示帮助`;

export class UsageError extends Error {}

// ---------- 参数 ----------

const VALUE_FLAGS = { "--url": "url", "--token": "token", "--label": "label", "--host": "host", "--out": "out", "--catalog": "catalog", "--orca": "orca", "--timeout": "timeout" };

/**
 * 解析命令行参数与环境变量；命令行优先
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 */
export function parseArgs(argv, env = process.env) {
  const opts = {
    url: env.OA_URL?.trim() || null,
    token: env.OA_CATALOG_TOKEN?.trim() || null,
    label: env.OA_CATALOG_LABEL?.trim() || null,
    host: env.OA_CATALOG_HOST?.trim() || null,
    dryRun: false,
    out: null,
    catalog: null,
    orca: null,
    timeoutMs: 20_000,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline = null;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg in VALUE_FLAGS) {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === null && value.startsWith("--"))) throw new UsageError(`${arg} 需要一个值`);
      const key = VALUE_FLAGS[arg];
      if (key === "timeout") {
        const sec = Number(value);
        if (!Number.isFinite(sec) || sec <= 0 || sec > 600) throw new UsageError("--timeout 需为 1–600 之间的秒数");
        opts.timeoutMs = Math.round(sec * 1000);
      } else opts[key] = value.trim();
    } else throw new UsageError(`未知参数：${arg}（--help 查看用法）`);
  }
  if (opts.help) return opts;
  if (opts.url) {
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(opts.url) ? opts.url : `http://${opts.url}`);
    } catch {
      throw new UsageError(`OA 地址格式不正确：${opts.url}`);
    }
    opts.url = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  }
  if (!opts.dryRun && !opts.out && !opts.url) throw new UsageError("请用 --url 指定 OA 地址（或使用 --dry-run / --out）");
  if (!opts.dryRun && opts.url && !opts.token) throw new UsageError("请用 --token 提供同步密钥（在 OA「设置 · Webhook 机器人 · Orca 模型目录」中复制）");
  return opts;
}

/** 主机标识只保留字母、数字和 . _ -（与服务端校验一致） */
export function sanitizeHost(raw) {
  const h = String(raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64)
    .replace(/[-.]+$/, "");
  return h || "orca-host";
}

// ---------- 路径 ----------

/**
 * 与 OA 的 resolveOrcaCatalogPath 相同：ORCA_MODEL_CATALOG_PATH > ORCA_USER_DATA_DIR > Electron userData 默认位置
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platform]
 * @param {string} [home]
 */
export function resolveCatalogPath(env = process.env, platform = process.platform, home = os.homedir()) {
  const file = "agent-model-catalog.db";
  if (env.ORCA_MODEL_CATALOG_PATH?.trim()) return env.ORCA_MODEL_CATALOG_PATH.trim();
  if (env.ORCA_USER_DATA_DIR?.trim()) return path.join(env.ORCA_USER_DATA_DIR.trim(), file);
  if (platform === "win32") return path.win32.join(env.APPDATA?.trim() || path.win32.join(home, "AppData", "Roaming"), "orca", file);
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "orca", file);
  return path.posix.join(env.XDG_CONFIG_HOME?.trim() || path.posix.join(home, ".config"), "orca", file);
}

// ---------- 解析（与 src/lib/im/orca-catalog.ts 一致） ----------

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const clip = (v, max) => (v && v.length > max ? v.slice(0, max) : v);
const agentId = (v) => {
  const t = str(v)?.toLowerCase();
  return t && t.length <= 40 && AGENT_RE.test(t) ? t : null;
};
const modelId = (v) => {
  const t = str(v);
  return t && t.length <= 120 && MODEL_RE.test(t) ? t : null;
};
const effortId = (v) => {
  const t = str(v)?.toLowerCase();
  return t && EFFORT_RE.test(t) ? t : null;
};

function parseEfforts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    const value = effortId(isObj(e) ? e.value : e);
    if (!value || out.some((x) => x.value === value)) continue;
    out.push({ value, label: (isObj(e) && str(e.label)) || value });
  }
  return out;
}

function parseModel(raw) {
  if (!isObj(raw)) return null;
  const id = modelId(raw.id);
  if (!id) return null;
  const efforts = parseEfforts(raw.efforts);
  return {
    id,
    label: str(raw.label) ?? id,
    description: str(raw.description),
    isDefault: raw.isDefault === true,
    efforts,
    effortsKnown: typeof raw.effortsKnown === "boolean" ? raw.effortsKnown : efforts.length > 0,
    defaultEffort: effortId(raw.defaultEffort),
  };
}

function parseModels(raw, stats) {
  const list = isObj(raw) && Array.isArray(raw.models) ? raw.models : [];
  const out = [];
  for (const m of list) {
    const model = parseModel(m);
    if (!model) {
      if (stats && isObj(m)) stats.skipped++;
      continue;
    }
    if (!out.some((x) => x.id === model.id)) out.push(model);
  }
  return out;
}

/**
 * rows 表每个基座取 seq 最大的有效记录；live 优先，为空时回退 discovered
 * @param {{ key: string; seq: number; value: string }[]} rows
 * @param {{ skipped: number } | null} [stats] 统计被跳过的不合法模型
 */
export function parseCatalogRows(rows, stats = null) {
  const out = new Map();
  const sorted = [...rows].sort((a, b) => Number(b.seq) - Number(a.seq));
  for (const row of sorted) {
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!isObj(value)) continue;
    const agent = agentId(str(value.agent) ?? String(row.key ?? "").split("\0")[0]);
    if (!agent || out.has(agent)) continue;
    const liveStats = { skipped: 0 };
    const discoveredStats = { skipped: 0 };
    const live = parseModels(value.live, liveStats);
    const discovered = parseModels(value.discovered, discoveredStats);
    if (!live.length && !discovered.length) continue;
    if (stats) stats.skipped += live.length ? liveStats.skipped : discoveredStats.skipped;
    const configured = isObj(value.configured) ? { model: modelId(value.configured.modelId), effort: effortId(value.configured.effort) } : null;
    out.set(agent, {
      agent,
      source: live.length ? "live" : "discovered",
      models: live.length ? live : discovered,
      configured: configured && (configured.model || configured.effort) ? configured : null,
    });
  }
  return out;
}

export function parseInstalledAgents(stdout) {
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  const result = isObj(json) && isObj(json.result) ? json.result : json;
  const list = isObj(result) && Array.isArray(result.agents) ? result.agents : null;
  if (!list) return null;
  const agents = [];
  for (const a of list) {
    if (!isObj(a)) continue;
    const id = agentId(a.id);
    if (!id || agents.some((x) => x.id === id)) continue;
    agents.push({ id, name: str(a.name), isDefault: a.default === true });
  }
  return { agents };
}

// ---------- 读取 ----------

const errMsg = (e) => (e instanceof Error ? e.message : String(e));

export function runOrcaInstalled(bin = "orca", timeoutMs = 15_000) {
  return new Promise((resolve) => {
    execFile(bin, ["agent", "installed", "--json"], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ status: err.code === "ENOENT" ? "unavailable" : "error", error: errMsg(err).split("\n")[0] });
        return;
      }
      const installed = parseInstalledAgents(String(stdout));
      resolve(installed ? { status: "ok", installed } : { status: "error", error: "无法解析 orca agent installed 的输出" });
    });
  });
}

async function openSqlite() {
  // node:sqlite 在部分 Node 版本会打印 ExperimentalWarning，这里只屏蔽这一条
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => {
    if (/sqlite/i.test(String(w?.message ?? w))) return;
    return emit.call(process, w, ...rest);
  };
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return (file, readOnly) => {
      const db = new DatabaseSync(file, { readOnly });
      return { all: (sql) => db.prepare(sql).all(), close: () => db.close() };
    };
  } catch {
    // 旧版 Node：回退到 better-sqlite3（在 OA 仓库内运行时可用）
    const mod = await import("better-sqlite3");
    const Database = mod.default ?? mod;
    return (file, readOnly) => {
      const db = new Database(file, { readonly: readOnly, fileMustExist: true, timeout: 300 });
      return { all: (sql) => db.prepare(sql).all(), close: () => db.close() };
    };
  } finally {
    process.emitWarning = emit;
  }
}

const QUERY = "SELECT key, seq, value FROM rows ORDER BY seq DESC LIMIT 2000";

function query(open, file, readOnly) {
  const db = open(file, readOnly);
  try {
    return db.all(QUERY);
  } finally {
    db.close();
  }
}

/** 只读打开；失败（-shm 不可访问、目录只读等）时复制主库与 -wal 到临时目录读取副本 */
export async function readCatalog(file, deps = {}) {
  if (!fs.existsSync(file)) return { status: "missing", agents: new Map(), skipped: 0 };
  let open;
  try {
    open = await (deps.openSqlite ?? openSqlite)();
  } catch (e) {
    return { status: "unreadable", agents: new Map(), skipped: 0, error: `无法加载 SQLite（需要 Node 22.5+）：${errMsg(e)}` };
  }
  let rows;
  try {
    rows = query(open, file, true);
  } catch (e) {
    if (/no such (table|column)/i.test(errMsg(e))) return { status: "invalid", agents: new Map(), skipped: 0, error: errMsg(e) };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-orca-sync-"));
    try {
      const copy = path.join(dir, "catalog.db");
      fs.copyFileSync(file, copy);
      if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
      rows = query(open, copy, false);
    } catch (e2) {
      const msg = errMsg(e2);
      return { status: /no such (table|column)|not a database/i.test(msg) ? "invalid" : "unreadable", agents: new Map(), skipped: 0, error: msg };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const stats = { skipped: 0 };
  return { status: "ok", agents: parseCatalogRows(rows, stats), skipped: stats.skipped };
}

// ---------- 快照 ----------

/**
 * 只包含本机真实检测到的基座（Orca 已安装 + 模型目录中出现的），不含静态预设；
 * 字段与 OA 的快照 Schema（version 1）一一对应，超出上限的部分截断。
 */
/**
 * @param {{ installed: { agents: { id: string; name: string | null; isDefault: boolean }[] } | null; catalog: Map<string, any>; host: string; label?: string | null; platform?: string; now?: Date }} input
 */
export function buildSnapshot({ installed, catalog, host, label = null, platform = process.platform, now = new Date() }) {
  const inst = installed?.agents ?? [];
  const defaultAgent = inst.find((a) => a.isDefault)?.id ?? null;
  const ids = [...inst.filter((a) => a.isDefault).map((a) => a.id), ...inst.filter((a) => !a.isDefault).map((a) => a.id), ...catalog.keys()].filter(
    (id, i, all) => all.indexOf(id) === i,
  );
  const agents = ids.slice(0, LIMITS.agents).map((id) => {
    const a = inst.find((x) => x.id === id);
    const entry = catalog.get(id);
    return {
      id,
      name: clip(a?.name ?? null, LIMITS.agentName),
      installed: !!a,
      isDefault: id === defaultAgent,
      modelSource: entry?.source ?? null,
      models: (entry?.models ?? []).slice(0, LIMITS.modelsPerAgent).map((m) => ({
        id: m.id,
        label: clip(m.label, LIMITS.label),
        description: clip(m.description, LIMITS.description),
        isDefault: m.isDefault,
        efforts: m.efforts.slice(0, LIMITS.efforts).map((e) => ({ value: e.value, label: clip(e.label, LIMITS.effortLabel) })),
        effortsKnown: m.effortsKnown,
        defaultEffort: m.defaultEffort,
      })),
      configured: entry?.configured ?? null,
    };
  });
  return {
    version: 1,
    source: { host: sanitizeHost(host), label: clip(label?.trim() || null, LIMITS.sourceLabel), platform, generator: GENERATOR },
    generatedAt: now.toISOString(),
    defaultAgent,
    agents,
  };
}

export function summarize(snapshot) {
  return { agents: snapshot.agents.length, models: snapshot.agents.reduce((n, a) => n + a.models.length, 0) };
}

// ---------- 推送 ----------

export async function pushSnapshot(url, token, snapshot, { fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  const endpoint = `${url}/api/im/webhooks/orca-catalog/sync`;
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": GENERATOR },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const cause = e?.cause?.code ?? (e?.name === "TimeoutError" ? "超时" : "");
    return { ok: false, status: 0, error: `无法连接 ${endpoint}${cause ? `（${cause}）` : ""}` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) return { ok: false, status: res.status, error: body?.error ?? `HTTP ${res.status}` };
  return { ok: true, status: res.status, body };
}

// ---------- 主流程 ----------

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const CLI_TEXT = { unavailable: "未找到 orca 命令（可用 --orca 指定路径）", error: "调用失败" };
const CATALOG_TEXT = { missing: "未找到", unreadable: "暂时无法读取", invalid: "格式无法识别" };
const seconds = (started) => `${((Date.now() - started) / 1000).toFixed(1)} 秒`;

/** 返回退出码：0 成功；1 参数错误；2 未读取到目录；3 推送失败 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const env = io.env ?? process.env;
  const out = io.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const err = io.stderr ?? ((s) => process.stderr.write(s + "\n"));
  const started = Date.now();
  let opts;
  try {
    opts = parseArgs(argv, env);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`[OA 目录同步] ${e.message}`);
    err(HELP);
    return 1;
  }
  if (opts.help) {
    out(HELP);
    return 0;
  }

  const host = sanitizeHost(opts.host || os.hostname());
  const catalogPath = opts.catalog || resolveCatalogPath(env);
  const [cli, catalog] = await Promise.all([
    (io.runOrca ?? runOrcaInstalled)(opts.orca || env.ORCA_CLI_PATH?.trim() || "orca"),
    (io.readCatalog ?? readCatalog)(catalogPath),
  ]);

  out(`[OA 目录同步] 主机：${host}${opts.label ? `（${opts.label}）` : ""}`);
  if (cli.status === "ok") {
    const def = cli.installed.agents.find((a) => a.isDefault)?.id;
    out(`  · Orca CLI：检测到 ${cli.installed.agents.length} 个基座${def ? `（默认 ${def}）` : ""}`);
  } else out(`  · Orca CLI：${CLI_TEXT[cli.status] ?? cli.status}${cli.error ? ` — ${cli.error}` : ""}，仅使用模型目录`);
  if (catalog.status === "ok") {
    out(`  · 模型目录：${catalogPath}（读取成功，${catalog.agents.size} 个基座${catalog.skipped ? `，跳过 ${catalog.skipped} 个 ID 不合法的模型` : ""}）`);
  } else out(`  · 模型目录：${catalogPath}（${CATALOG_TEXT[catalog.status] ?? catalog.status}${catalog.error ? ` — ${catalog.error}` : ""}）`);

  const snapshot = buildSnapshot({ installed: cli.status === "ok" ? cli.installed : null, catalog: catalog.agents, host, label: opts.label, now: io.now?.() ?? new Date() });
  const sum = summarize(snapshot);
  if (!sum.agents) {
    err("[OA 目录同步] 没有读取到任何基座或模型：请确认本机已安装并运行过 Orca，或用 --orca / --catalog 指定路径");
    return 2;
  }
  out(`  · 汇总：${sum.agents} 个基座，${sum.models} 个模型`);
  for (const a of snapshot.agents) {
    out(`      - ${a.id}${a.name && a.name !== a.id ? `（${a.name}）` : ""}：${a.models.length} 个模型${a.isDefault ? " · Orca 默认" : ""}${a.installed ? "" : " · 未安装"}`);
  }

  if (opts.out) {
    const file = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");
    out(`  · 已导出：${file}`);
  }

  if (opts.dryRun || !opts.url) {
    out(`${opts.dryRun ? "[dry-run] 未推送" : "未指定 --url，未推送"}，用时 ${seconds(started)}`);
    return 0;
  }

  const r = await (io.push ?? pushSnapshot)(opts.url, opts.token, snapshot, { timeoutMs: opts.timeoutMs });
  if (!r.ok) {
    err(`[OA 目录同步] 推送到 ${opts.url} 失败${r.status ? `（HTTP ${r.status}）` : ""}：${r.error}`);
    return 3;
  }
  const b = r.body ?? {};
  const kept = b.customModelCount ? `（另有 ${b.customModelCount} 个手动维护的模型保持不变）` : "";
  out(`  · 推送到 ${opts.url}：成功（HTTP ${r.status}）· OA 已记录 ${b.agentCount ?? sum.agents} 个基座 / ${b.modelCount ?? sum.models} 个模型${kept} · 同步时间 ${formatTime(b.syncedAt ?? new Date().toISOString())}`);
  out(`完成，用时 ${seconds(started)}`);
  return 0;
}

const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`[OA 目录同步] 意外错误：${errMsg(e)}\n`);
      process.exit(1);
    },
  );
}
