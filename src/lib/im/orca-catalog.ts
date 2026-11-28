import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORCA_AGENT_LABELS } from "@/components/im/orca-agent-icons.generated";
import {
  AGENT_PRESETS,
  type CatalogOrigin,
  type OrcaAgent,
  type OrcaCatalog,
  type OrcaEffort,
  type OrcaModel,
  type OrcaModelSource,
  type OrcaSourceStatus,
} from "./orca-catalog-shared";
import { agentField, effortField, modelField } from "./webhook-run-config";

/*
 * 发现同机 Orca 的基座与模型目录（只读）：
 *   - 基座：`orca agent installed --json`（Orca 检测到且未在设置中关闭的基座、默认基座）；
 *   - 模型 / Effort：Orca 本地模型目录 agent-model-catalog.db（SQLite，WAL 模式，Orca 运行时持续写入）。
 * 任何一步失败都降级为静态预设，不抛错。不引入 server-only：单元测试直接导入本模块。
 */

// ---------- 路径 ----------

type Env = Record<string, string | undefined>;

/**
 * 模型目录路径：ORCA_MODEL_CATALOG_PATH > ORCA_USER_DATA_DIR/agent-model-catalog.db >
 * Electron userData 默认位置（Windows %APPDATA%\orca；macOS ~/Library/Application Support/orca；Linux $XDG_CONFIG_HOME/orca 或 ~/.config/orca）
 */
export function resolveOrcaCatalogPath(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const file = "agent-model-catalog.db";
  if (env.ORCA_MODEL_CATALOG_PATH?.trim()) return env.ORCA_MODEL_CATALOG_PATH.trim();
  if (env.ORCA_USER_DATA_DIR?.trim()) return path.join(env.ORCA_USER_DATA_DIR.trim(), file);
  // 用 posix / win32 拼接，避免在一个平台上计算另一个平台的路径时分隔符混用
  if (platform === "win32") return path.win32.join(env.APPDATA?.trim() || path.win32.join(home, "AppData", "Roaming"), "orca", file);
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "orca", file);
  return path.posix.join(env.XDG_CONFIG_HOME?.trim() || path.posix.join(home, ".config"), "orca", file);
}

// ---------- 目录记录解析（纯函数） ----------

export type CatalogRow = { key: string; seq: number; value: string };

export type CatalogAgentEntry = {
  agent: string;
  source: Exclude<OrcaModelSource, null>;
  models: OrcaModel[];
  configured: { model: string | null; effort: string | null } | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** 复用 OA 出站校验（agent / model / effort 字段），不合法或空白时返回 null */
const valid = (schema: { safeParse: (v: unknown) => { success: boolean; data?: string | null } }, v: unknown): string | null => {
  const r = schema.safeParse(v);
  return r.success && r.data ? r.data : null;
};

function parseEfforts(raw: unknown): OrcaEffort[] {
  if (!Array.isArray(raw)) return [];
  const out: OrcaEffort[] = [];
  for (const e of raw) {
    const value = valid(effortField, isObj(e) ? e.value : e);
    if (!value || out.some((x) => x.value === value)) continue;
    out.push({ value, label: (isObj(e) && str(e.label)) || value });
  }
  return out;
}

/** 解析单个模型；ID 不符合 OA 出站校验（如含空格）的模型无法选择，直接跳过 */
function parseModel(raw: unknown): OrcaModel | null {
  if (!isObj(raw)) return null;
  const id = valid(modelField, raw.id);
  if (!id) return null;
  const efforts = parseEfforts(raw.efforts);
  return {
    id,
    label: str(raw.label) ?? id,
    description: str(raw.description),
    isDefault: raw.isDefault === true,
    efforts,
    // 显式 effortsKnown 优先；声明了非空 efforts 也视为已知
    effortsKnown: typeof raw.effortsKnown === "boolean" ? raw.effortsKnown : efforts.length > 0,
    defaultEffort: valid(effortField, raw.defaultEffort),
  };
}

function parseModels(raw: unknown): OrcaModel[] {
  const list = isObj(raw) && Array.isArray(raw.models) ? raw.models : [];
  const out: OrcaModel[] = [];
  for (const m of list) {
    const model = parseModel(m);
    if (model && !out.some((x) => x.id === model.id)) out.push(model);
  }
  return out;
}

/**
 * rows 表：key = `${agent}\0${fingerprint}`，value 为 JSON（agent / live / discovered / configured）。
 * 每个基座取 seq 最大的一条；模型优先取 live（实时探测），为空时回退 discovered。
 * 单条记录损坏只跳过该条，继续寻找同一基座的上一条有效记录。
 */
export function parseCatalogRows(rows: CatalogRow[]): Map<string, CatalogAgentEntry> {
  const out = new Map<string, CatalogAgentEntry>();
  const sorted = [...rows].sort((a, b) => Number(b.seq) - Number(a.seq));
  for (const row of sorted) {
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!isObj(value)) continue;
    const agent = valid(agentField, str(value.agent) ?? String(row.key ?? "").split("\0")[0]);
    if (!agent || out.has(agent)) continue;
    const live = parseModels(value.live);
    const discovered = parseModels(value.discovered);
    if (!live.length && !discovered.length) continue;
    const configured = isObj(value.configured)
      ? { model: valid(modelField, value.configured.modelId), effort: valid(effortField, value.configured.effort) }
      : null;
    out.set(agent, {
      agent,
      source: live.length ? "live" : "discovered",
      models: live.length ? live : discovered,
      configured: configured && (configured.model || configured.effort) ? configured : null,
    });
  }
  return out;
}

// ---------- 只读读取 SQLite ----------

export type CatalogReadResult =
  | { status: "ok"; agents: Map<string, CatalogAgentEntry>; via: "direct" | "snapshot" }
  | { status: "missing" | "unreadable" | "invalid"; agents: Map<string, CatalogAgentEntry>; error?: string };

type SqliteDb = { prepare: (sql: string) => { all: (...a: unknown[]) => unknown[] }; close: () => void };
type SqliteCtor = new (file: string, opts?: Record<string, unknown>) => SqliteDb;

const MAX_ROWS = 2000;
const QUERY = `SELECT key, seq, value FROM rows ORDER BY seq DESC LIMIT ${MAX_ROWS}`;

async function loadSqlite(): Promise<SqliteCtor> {
  const mod = (await import("better-sqlite3")) as unknown as { default?: SqliteCtor } & SqliteCtor;
  return mod.default ?? mod;
}

function queryRows(Database: SqliteCtor, file: string, readonly: boolean): CatalogRow[] {
  // readonly：不写主库、不做 checkpoint；WAL 模式下读者不阻塞 Orca 写入，单条 SELECT 即一个一致快照。
  // 不能用 immutable=1：目录数据大多仍在 -wal 中，忽略 WAL 会读到旧数据。
  const db = new Database(file, { readonly, fileMustExist: true, timeout: 300 });
  try {
    return db.prepare(QUERY).all() as CatalogRow[];
  } finally {
    db.close();
  }
}

/**
 * 直接只读打开失败（例如 -shm 无法访问、目录只读、旧版 SQLite 的 WAL 只读限制）时，
 * 把主库与 -wal 复制到临时目录后读取副本：SQLite 恢复 WAL 时会校验帧校验和，复制到一半的帧会被丢弃，结果仍是一致快照。
 */
function querySnapshot(Database: SqliteCtor, file: string): CatalogRow[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-orca-catalog-"));
  try {
    const copy = path.join(dir, "catalog.db");
    fs.copyFileSync(file, copy);
    if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
    return queryRows(Database, copy, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function readOrcaModelCatalog(file: string, deps: { loadSqlite?: () => Promise<SqliteCtor> } = {}): Promise<CatalogReadResult> {
  const empty = new Map<string, CatalogAgentEntry>();
  if (!fs.existsSync(file)) return { status: "missing", agents: empty };
  let Database: SqliteCtor;
  try {
    Database = await (deps.loadSqlite ?? loadSqlite)();
  } catch (e) {
    return { status: "unreadable", agents: empty, error: `SQLite 模块不可用：${errMsg(e)}` };
  }
  let rows: CatalogRow[];
  let via: "direct" | "snapshot" = "direct";
  try {
    rows = queryRows(Database, file, true);
  } catch (e) {
    // 表结构变动不是并发问题，复制也无济于事
    if (/no such (table|column)/i.test(errMsg(e))) return { status: "invalid", agents: empty, error: errMsg(e) };
    try {
      rows = querySnapshot(Database, file);
      via = "snapshot";
    } catch (e2) {
      const msg = errMsg(e2);
      return { status: /no such (table|column)|not a database/i.test(msg) ? "invalid" : "unreadable", agents: empty, error: msg };
    }
  }
  return { status: "ok", agents: parseCatalogRows(rows), via };
}

// ---------- orca agent installed --json ----------

export type InstalledAgents = { agents: { id: string; name: string | null; isDefault: boolean }[] };

export function parseInstalledAgents(stdout: string): InstalledAgents | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  const result = isObj(json) && isObj(json.result) ? json.result : json;
  const list = isObj(result) && Array.isArray(result.agents) ? result.agents : null;
  if (!list) return null;
  const agents: InstalledAgents["agents"] = [];
  for (const a of list) {
    if (!isObj(a)) continue;
    const id = valid(agentField, a.id);
    if (!id || agents.some((x) => x.id === id)) continue;
    agents.push({ id, name: str(a.name), isDefault: a.default === true });
  }
  return { agents };
}

export type CliResult = { status: "ok"; installed: InstalledAgents } | { status: "unavailable" | "error" | "disabled"; error?: string };

/** ORCA_CATALOG_LOCAL=off / 0 / false：不探测本机 Orca（NAS / 容器部署或测试“无本机 CLI”场景） */
export function localDiscoveryDisabled(env: Env = process.env): boolean {
  return /^(off|0|false|no|disabled?)$/i.test(env.ORCA_CATALOG_LOCAL?.trim() ?? "");
}

/** 执行 Orca CLI（ORCA_CLI_PATH 可覆盖可执行文件路径）；不经 shell，超时即放弃 */
export function runOrcaInstalled(env: Env = process.env, timeoutMs = 5000): Promise<CliResult> {
  const bin = env.ORCA_CLI_PATH?.trim() || "orca";
  return new Promise((resolve) => {
    execFile(bin, ["agent", "installed", "--json"], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        resolve({ status: code === "ENOENT" ? "unavailable" : "error", error: errMsg(err).split("\n")[0] });
        return;
      }
      const installed = parseInstalledAgents(String(stdout));
      resolve(installed ? { status: "ok", installed } : { status: "error", error: "无法解析 orca agent installed 的输出" });
    });
  });
}

// ---------- 合并 ----------

/**
 * 合并顺序：Orca 检测到的基座（默认基座在前）→ 仅出现在模型目录中的基座 → 未检测到的静态预设。
 * 预设始终保留：Webhook 机器人可能运行在另一台 Orca 上，本机未安装不代表不可用。
 */
export function buildOrcaCatalog(cli: CliResult, catalog: CatalogReadResult, now = new Date(), localHost: string | null = null): OrcaCatalog {
  const installed = cli.status === "ok" ? cli.installed.agents : [];
  const defaultAgent = installed.find((a) => a.isDefault)?.id ?? null;
  const ids = [
    ...installed.filter((a) => a.isDefault).map((a) => a.id),
    ...installed.filter((a) => !a.isDefault).map((a) => a.id),
    ...[...catalog.agents.keys()],
    ...AGENT_PRESETS,
  ].filter((id, i, all) => all.indexOf(id) === i);

  const agents: OrcaAgent[] = ids.map((id) => {
    const inst = installed.find((a) => a.id === id);
    const entry = catalog.agents.get(id);
    return {
      id,
      label: inst?.name ?? ORCA_AGENT_LABELS[id] ?? id,
      installed: !!inst,
      isDefault: id === defaultAgent,
      modelSource: entry?.source ?? null,
      models: entry?.models ?? [],
      configured: entry?.configured ?? null,
    };
  });

  const warnings: string[] = [];
  if (cli.status === "unavailable") warnings.push("未找到 Orca CLI，基座列表使用预设");
  else if (cli.status === "error") warnings.push("调用 Orca CLI 失败，基座列表使用预设");
  if (catalog.status === "missing") warnings.push("未找到 Orca 模型目录，模型使用常用预设，可手动输入");
  else if (catalog.status === "unreadable") warnings.push("Orca 模型目录暂时无法读取，模型使用常用预设，可手动输入");
  else if (catalog.status === "invalid") warnings.push("Orca 模型目录格式无法识别，模型使用常用预设，可手动输入");
  const status: OrcaSourceStatus = { cli: cli.status, catalog: catalog.status };
  const origin: CatalogOrigin = cli.status === "ok" || catalog.agents.size > 0 ? { kind: "local", host: localHost } : { kind: "preset" };
  return { agents, defaultAgent, status, origin, customModelCount: 0, warnings, fetchedAt: now.toISOString() };
}
