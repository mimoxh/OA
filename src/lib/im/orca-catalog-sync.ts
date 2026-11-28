import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { ORCA_AGENT_LABELS } from "@/components/im/orca-agent-icons.generated";
import {
  AGENT_PRESETS,
  SYNC_GUIDE,
  SYNC_STALE_MS,
  type OrcaAgent,
  type OrcaCatalog,
  type OrcaEffort,
  type OrcaModel,
} from "./orca-catalog-shared";
import { buildOrcaCatalog, type CatalogReadResult, type CliResult } from "./orca-catalog";
import { AGENT_RE, EFFORT_RE, MODEL_RE } from "./webhook-run-config";
import { decryptSecret, encryptSecret, hashInboundToken, parseBearer, verifyInboundToken } from "./webhook-crypto";

/*
 * Orca 目录同步（方案 A）：运行 Orca 的电脑执行 scripts/orca/sync-catalog.mjs，把基座 / 模型 / Effort 目录
 * POST 到 /api/im/webhooks/orca-catalog/sync，OA 持久化为快照（每台主机一行）；管理员手动维护的自定义模型
 * 单独存表，读取时再合并，因此 Push 同步永远不会覆盖它们。
 * 不引入 server-only / @/lib/db：数据库函数只接受调用方传入的 client，单元测试直接导入本模块。
 */

// ---------- 快照 JSON Schema ----------

/** 请求体上限：真实目录（约 300 个模型）规范化后约 100 KB */
export const MAX_SYNC_BODY_BYTES = 1024 * 1024;
export const MAX_AGENTS = 64;
export const MAX_MODELS_PER_AGENT = 500;
export const MAX_MODELS_TOTAL = 5000;
/** 最多保留的同步主机数，超出时删除最久未同步的主机 */
export const MAX_SYNC_HOSTS = 10;

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const agentId = z.string().max(40, "基座标识不能超过 40 个字符").regex(AGENT_RE, "基座标识只能包含小写字母、数字和 . _ -");
const modelId = z.string().max(120, "模型 ID 不能超过 120 个字符").regex(MODEL_RE, "模型 ID 只能包含字母、数字和 . _ - : / @ +");
const effortToken = z.string().regex(EFFORT_RE, "思考强度只能是小写字母开头的标识（如 low / high / max），最长 24 个字符");
const text = (max: number) => z.string().max(max, `文本不能超过 ${max} 个字符`);

const effortSchema = z.strictObject({ value: effortToken, label: text(60).optional() });
const modelSchema = z.strictObject({
  id: modelId,
  label: text(200).optional(),
  description: text(1000).nullish(),
  isDefault: z.boolean().optional(),
  efforts: z.array(effortSchema).max(32, "单个模型最多 32 个思考强度").optional(),
  effortsKnown: z.boolean().optional(),
  defaultEffort: effortToken.nullish(),
});
const agentSchema = z.strictObject({
  id: agentId,
  name: text(80).nullish(),
  installed: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  modelSource: z.enum(["live", "discovered"]).nullish(),
  models: z.array(modelSchema).max(MAX_MODELS_PER_AGENT, `单个基座最多 ${MAX_MODELS_PER_AGENT} 个模型`),
  configured: z.strictObject({ model: modelId.nullish(), effort: effortToken.nullish() }).nullish(),
});

function checkUnique(agents: z.output<typeof agentSchema>[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  let total = 0;
  agents.forEach((a, i) => {
    if (seen.has(a.id)) ctx.addIssue({ code: "custom", path: ["agents", i, "id"], message: `基座 ${a.id} 重复` });
    seen.add(a.id);
    const ids = new Set<string>();
    a.models.forEach((m, j) => {
      if (ids.has(m.id)) ctx.addIssue({ code: "custom", path: ["agents", i, "models", j, "id"], message: `基座 ${a.id} 的模型 ${m.id} 重复` });
      ids.add(m.id);
    });
    total += a.models.length;
  });
  if (total > MAX_MODELS_TOTAL) ctx.addIssue({ code: "custom", path: ["agents"], message: `模型总数不能超过 ${MAX_MODELS_TOTAL}` });
}

/** POST /api/im/webhooks/orca-catalog/sync 的请求体（sync-catalog.mjs --out 导出的文件同样可在设置页导入） */
export const snapshotSchema = z
  .strictObject({
    version: z.literal(1, { error: "仅支持 version: 1 的目录快照" }),
    source: z.strictObject({
      host: z.string().trim().min(1, "请提供来源主机名").max(64, "主机名不能超过 64 个字符").regex(HOST_RE, "主机名只能包含字母、数字和 . _ -"),
      label: text(60).nullish(),
      platform: text(20).nullish(),
      generator: text(60).nullish(),
    }),
    generatedAt: z.string().max(40).optional(),
    defaultAgent: agentId.nullish(),
    agents: z.array(agentSchema).max(MAX_AGENTS, `基座数量不能超过 ${MAX_AGENTS}`),
  })
  .superRefine((v, ctx) => checkUnique(v.agents, ctx));

export type SnapshotInput = z.input<typeof snapshotSchema>;

/** 数据库中保存的规范化目录（payload 列） */
const storedPayloadSchema = z.object({
  defaultAgent: agentId.nullable(),
  agents: z.array(agentSchema),
});

export type SnapshotAgent = {
  id: string;
  name: string | null;
  installed: boolean;
  isDefault: boolean;
  modelSource: "live" | "discovered" | null;
  models: OrcaModel[];
  configured: { model: string | null; effort: string | null } | null;
};

export type StoredSnapshot = {
  host: string;
  label: string | null;
  via: string;
  syncedAt: Date;
  agentCount: number;
  modelCount: number;
  defaultAgent: string | null;
  agents: SnapshotAgent[];
};

function issueText(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "目录快照格式不正确";
  const where = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "");
  const msg =
    issue.code === "unrecognized_keys"
      ? `不支持的字段：${issue.keys.join(", ")}`
      : /^Invalid|^Expected|^Too/.test(issue.message)
        ? "格式不正确"
        : issue.message;
  return where ? `${where}：${msg}` : msg;
}

export function parseSnapshot(input: unknown): { ok: true; data: z.output<typeof snapshotSchema> } | { ok: false; error: string } {
  const r = snapshotSchema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: issueText(r.error) };
}

function normalizeModel(m: z.output<typeof modelSchema>): OrcaModel {
  const efforts: OrcaEffort[] = [];
  for (const e of m.efforts ?? []) {
    if (!efforts.some((x) => x.value === e.value)) efforts.push({ value: e.value, label: e.label?.trim() || e.value });
  }
  return {
    id: m.id,
    label: m.label?.trim() || m.id,
    description: m.description?.trim() || null,
    isDefault: m.isDefault === true,
    efforts,
    effortsKnown: m.effortsKnown ?? efforts.length > 0,
    defaultEffort: m.defaultEffort ?? null,
  };
}

function normalizeAgent(a: z.output<typeof agentSchema>): SnapshotAgent {
  const models = a.models.map(normalizeModel);
  const configured = a.configured && (a.configured.model || a.configured.effort) ? { model: a.configured.model ?? null, effort: a.configured.effort ?? null } : null;
  return {
    id: a.id,
    name: a.name?.trim() || null,
    installed: a.installed === true,
    isDefault: a.isDefault === true,
    modelSource: models.length ? (a.modelSource ?? "discovered") : null,
    models,
    configured,
  };
}

export function normalizeSnapshot(v: z.output<typeof snapshotSchema>) {
  const agents = v.agents.map(normalizeAgent);
  const defaultAgent =
    (v.defaultAgent && agents.some((a) => a.id === v.defaultAgent) ? v.defaultAgent : null) ?? agents.find((a) => a.isDefault)?.id ?? null;
  for (const a of agents) a.isDefault = a.id === defaultAgent;
  return {
    host: v.source.host.toLowerCase(),
    label: v.source.label?.trim() || null,
    defaultAgent,
    agents,
    agentCount: agents.length,
    modelCount: agents.reduce((n, a) => n + a.models.length, 0),
  };
}

// ---------- 快照持久化 ----------

export type SyncVia = "token" | "session" | "local";

export type SaveResult = { host: string; label: string | null; agentCount: number; modelCount: number; syncedAt: string; unchanged: boolean };

/** 保存（覆盖）一台主机的快照；超出 MAX_SYNC_HOSTS 时删除最久未同步的主机 */
export async function saveSnapshot(client: DbClient, v: z.output<typeof snapshotSchema>, via: SyncVia, now = new Date()): Promise<SaveResult> {
  const n = normalizeSnapshot(v);
  const payload = JSON.stringify({ defaultAgent: n.defaultAgent, agents: n.agents });
  const prev = await client.orcaCatalogSnapshot.findUnique({ where: { sourceHost: n.host }, select: { payload: true } });
  const data = { sourceLabel: n.label, payload, agentCount: n.agentCount, modelCount: n.modelCount, syncedVia: via, syncedAt: now };
  await client.orcaCatalogSnapshot.upsert({ where: { sourceHost: n.host }, create: { sourceHost: n.host, ...data }, update: data });
  const keep = await client.orcaCatalogSnapshot.findMany({ orderBy: { syncedAt: "desc" }, take: MAX_SYNC_HOSTS, select: { id: true } });
  await client.orcaCatalogSnapshot.deleteMany({ where: { id: { notIn: keep.map((k) => k.id) } } });
  return { host: n.host, label: n.label, agentCount: n.agentCount, modelCount: n.modelCount, syncedAt: now.toISOString(), unchanged: prev?.payload === payload };
}

/** 读取全部快照（最近同步的在前）；单条损坏只跳过该条 */
export async function loadSnapshots(client: DbClient): Promise<StoredSnapshot[]> {
  const rows = await client.orcaCatalogSnapshot.findMany({ orderBy: { syncedAt: "desc" } });
  const out: StoredSnapshot[] = [];
  for (const r of rows) {
    let json: unknown;
    try {
      json = JSON.parse(r.payload);
    } catch {
      continue;
    }
    const p = storedPayloadSchema.safeParse(json);
    if (!p.success) continue;
    out.push({
      host: r.sourceHost,
      label: r.sourceLabel,
      via: r.syncedVia,
      syncedAt: r.syncedAt,
      agentCount: r.agentCount,
      modelCount: r.modelCount,
      defaultAgent: p.data.defaultAgent,
      agents: p.data.agents.map(normalizeAgent),
    });
  }
  return out;
}

export async function deleteSnapshot(client: DbClient, host: string) {
  await client.orcaCatalogSnapshot.deleteMany({ where: { sourceHost: host.toLowerCase() } });
}

// ---------- 自定义模型 ----------

export type CustomModel = { id: string; agent: string; modelId: string; label: string | null; efforts: string[]; defaultEffort: string | null };

export const customModelSchema = z
  .object({
    agent: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().min(1, "请填写基座标识").pipe(agentId)),
    modelId: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1, "请填写模型 ID").pipe(modelId)),
    label: z.string().trim().max(80, "显示名称不能超过 80 个字符").optional(),
    efforts: z
      .array(z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), effortToken))
      .max(16, "最多 16 个思考强度")
      .default([]),
    defaultEffort: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() || null : v), effortToken.nullish()),
  })
  .refine((v) => !v.defaultEffort || !v.efforts.length || v.efforts.includes(v.defaultEffort), {
    message: "默认思考强度需在可用强度列表中",
    path: ["defaultEffort"],
  });

function parseEffortList(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && EFFORT_RE.test(x)) : [];
  } catch {
    return [];
  }
}

export async function listCustomModels(client: DbClient): Promise<CustomModel[]> {
  const rows = await client.orcaCustomModel.findMany({ orderBy: [{ agent: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, agent: r.agent, modelId: r.modelId, label: r.label, efforts: parseEffortList(r.efforts), defaultEffort: r.defaultEffort }));
}

/** 新增或更新（同一基座下模型 ID 相同即视为同一模型） */
export async function upsertCustomModel(client: DbClient, input: z.input<typeof customModelSchema>, userId: string | null): Promise<CustomModel> {
  const r = customModelSchema.safeParse(input);
  if (!r.success) throw new Error(issueText(r.error));
  const v = r.data;
  const efforts = [...new Set(v.efforts)];
  const data = { label: v.label || null, efforts: JSON.stringify(efforts), defaultEffort: v.defaultEffort ?? null };
  const row = await client.orcaCustomModel.upsert({
    where: { agent_modelId: { agent: v.agent, modelId: v.modelId } },
    create: { agent: v.agent, modelId: v.modelId, createdById: userId, ...data },
    update: data,
  });
  return { id: row.id, agent: row.agent, modelId: row.modelId, label: row.label, efforts, defaultEffort: row.defaultEffort };
}

export async function deleteCustomModel(client: DbClient, id: string) {
  await client.orcaCustomModel.deleteMany({ where: { id } });
}

// ---------- 合并 ----------

const presetAgent = (id: string): OrcaAgent => ({
  id,
  label: ORCA_AGENT_LABELS[id] ?? id,
  installed: false,
  isDefault: false,
  modelSource: null,
  models: [],
  configured: null,
});

/**
 * 多台主机合并：按同步时间从新到旧，每个基座取最近一次同步中包含它的那台主机的模型列表；
 * 任一主机检测到即视为已安装。默认基座取最近同步主机的设置。
 */
export function mergeSnapshots(snapshots: StoredSnapshot[]): { agents: SnapshotAgent[]; defaultAgent: string | null } {
  const sorted = [...snapshots].sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime());
  const byId = new Map<string, SnapshotAgent>();
  for (const s of sorted) {
    for (const a of s.agents) {
      const prev = byId.get(a.id);
      if (!prev) byId.set(a.id, { ...a, models: [...a.models] });
      else if (a.installed) prev.installed = true;
    }
  }
  const defaultAgent = sorted.map((s) => s.defaultAgent).find((d) => d && byId.has(d)) ?? null;
  return { agents: [...byId.values()], defaultAgent };
}

export function buildSyncedCatalog(snapshots: StoredSnapshot[], cli: CliResult, local: CatalogReadResult, now = new Date()): OrcaCatalog {
  const primary = [...snapshots].sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime())[0];
  const { agents: merged, defaultAgent } = mergeSnapshots(snapshots);
  const ids = [
    ...(defaultAgent ? [defaultAgent] : []),
    ...merged.filter((a) => a.installed).map((a) => a.id),
    ...merged.map((a) => a.id),
    ...AGENT_PRESETS,
  ].filter((id, i, all) => all.indexOf(id) === i);
  const agents: OrcaAgent[] = ids.map((id) => {
    const a = merged.find((x) => x.id === id);
    if (!a) return presetAgent(id);
    return {
      id,
      label: a.name ?? ORCA_AGENT_LABELS[id] ?? id,
      installed: a.installed,
      isDefault: id === defaultAgent,
      modelSource: a.models.length ? a.modelSource : null,
      models: a.models,
      configured: a.configured,
    };
  });
  const warnings: string[] = [];
  const age = now.getTime() - primary.syncedAt.getTime();
  if (age > SYNC_STALE_MS) warnings.push(`已同步的 Orca 目录已 ${Math.floor(age / 86400_000)} 天未更新，可在运行 Orca 的电脑上重新执行同步命令`);
  return {
    agents,
    defaultAgent,
    status: { cli: cli.status, catalog: local.status },
    origin: { kind: "synced", host: primary.host, label: primary.label, syncedAt: primary.syncedAt.toISOString(), hostCount: snapshots.length },
    customModelCount: 0,
    warnings,
    fetchedAt: now.toISOString(),
  };
}

/** 把手动维护的模型合并进目录：自定义模型排在该基座列表最前；同步目录已有同 ID 模型时沿用同步数据并标记为自定义 */
export function applyCustomModels(catalog: OrcaCatalog, customs: CustomModel[]): OrcaCatalog {
  if (!customs.length) return catalog;
  const agents = catalog.agents.map((a) => ({ ...a, models: [...a.models] }));
  for (const c of customs) {
    let agent = agents.find((a) => a.id === c.agent);
    if (!agent) {
      agent = presetAgent(c.agent);
      const firstPreset = agents.findIndex((a) => !a.installed && !a.modelSource);
      agents.splice(firstPreset < 0 ? agents.length : firstPreset, 0, agent);
    }
    const existing = agent.models.findIndex((m) => m.id === c.modelId);
    if (existing >= 0) {
      agent.models[existing] = { ...agent.models[existing], custom: true };
      continue;
    }
    const efforts = c.efforts.map((value) => ({ value, label: value }));
    const insertAt = agent.models.filter((m) => m.custom).length;
    agent.models.splice(insertAt, 0, {
      id: c.modelId,
      label: c.label || c.modelId,
      description: null,
      isDefault: false,
      efforts,
      effortsKnown: efforts.length > 0,
      defaultEffort: c.defaultEffort,
      custom: true,
    });
    if (!agent.modelSource) agent.modelSource = "custom";
  }
  return { ...catalog, agents, customModelCount: customs.length };
}

/**
 * 多源优先级：
 *   1. 本机 Orca CLI 可用 → 实时读取本机（OA 与 Orca 在同一台电脑）；
 *   2. 本机无 CLI（NAS / 容器）且数据库中有同步快照 → 使用快照；
 *   3. 都没有 → 本机模型目录（若可读）或静态预设，并给出同步引导。
 * 三种情况都会合并手动维护的自定义模型。
 */
export function resolveOrcaCatalog(input: {
  cli: CliResult;
  local: CatalogReadResult;
  snapshots: StoredSnapshot[];
  customs: CustomModel[];
  localHost?: string | null;
  now?: Date;
}): OrcaCatalog {
  const now = input.now ?? new Date();
  let base: OrcaCatalog;
  if (input.cli.status === "ok") base = buildOrcaCatalog(input.cli, input.local, now, input.localHost ?? null);
  else if (input.snapshots.length) base = buildSyncedCatalog(input.snapshots, input.cli, input.local, now);
  else {
    base = buildOrcaCatalog(input.cli, input.local, now, input.localHost ?? null);
    if (base.origin.kind === "preset") {
      base = { ...base, warnings: input.cli.status === "error" ? [base.warnings[0], SYNC_GUIDE] : [SYNC_GUIDE] };
    }
  }
  return applyCustomModels(base, input.customs);
}

/** 本机 Orca 目录转换为快照（OA 与 Orca 同机时自动记录，CLI 暂时不可用时仍有最近的真实目录可用） */
export function catalogToSnapshot(catalog: OrcaCatalog, host: string, label: string | null): z.output<typeof snapshotSchema> | null {
  const agents = catalog.agents
    .filter((a) => a.installed || (a.modelSource && a.modelSource !== "custom"))
    .map((a) => ({
      id: a.id,
      name: a.label,
      installed: a.installed,
      isDefault: a.isDefault,
      modelSource: a.modelSource === "live" || a.modelSource === "discovered" ? a.modelSource : null,
      models: a.models
        .filter((m) => !m.custom)
        .map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description,
          isDefault: m.isDefault,
          efforts: m.efforts,
          effortsKnown: m.effortsKnown,
          defaultEffort: m.defaultEffort,
        })),
      configured: a.configured,
    }));
  if (!agents.length) return null;
  const safeHost = host.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64) || "oa-host";
  const r = snapshotSchema.safeParse({ version: 1, source: { host: safeHost, label, generator: "oa-local" }, defaultAgent: catalog.defaultAgent, agents });
  return r.success ? r.data : null;
}

// ---------- 同步密钥 ----------

export const SYNC_TOKEN_PREFIX = "oacat_";
const KEY_ID = "default";

export type SyncKeyInfo = { exists: boolean; prefix: string | null; createdAt: string | null; lastUsedAt: string | null };

export async function getSyncKeyInfo(client: DbClient): Promise<SyncKeyInfo> {
  const k = await client.orcaCatalogSyncKey.findUnique({ where: { id: KEY_ID } });
  return k
    ? { exists: true, prefix: k.tokenPrefix, createdAt: k.updatedAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null }
    : { exists: false, prefix: null, createdAt: null, lastUsedAt: null };
}

/** 生成 / 重置同步密钥，旧密钥立即失效；返回明文 */
export async function rotateSyncKey(client: DbClient, userId: string | null): Promise<string> {
  const token = SYNC_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const data = { tokenHash: hashInboundToken(token), tokenPrefix: token.slice(0, SYNC_TOKEN_PREFIX.length + 6), tokenCipher: encryptSecret(token), createdById: userId, lastUsedAt: null };
  await client.orcaCatalogSyncKey.upsert({ where: { id: KEY_ID }, create: { id: KEY_ID, ...data }, update: data });
  return token;
}

/** 管理员查看 / 复制当前密钥；AUTH_SECRET 变更导致无法解密时返回 null（需重置） */
export async function revealSyncKey(client: DbClient): Promise<string | null> {
  const k = await client.orcaCatalogSyncKey.findUnique({ where: { id: KEY_ID } });
  if (!k) return null;
  try {
    return decryptSecret(k.tokenCipher);
  } catch {
    return null;
  }
}

export type SyncAuth = { kind: "sync-key" } | { kind: "webhook"; connectorId: string; botName: string };

/** 同步密钥，或任一已启用 Webhook 机器人的回调 Token */
export async function authenticateSyncToken(client: DbClient, token: string, now = new Date()): Promise<SyncAuth | null> {
  if (!token || token.length > 200) return null;
  const key = await client.orcaCatalogSyncKey.findUnique({ where: { id: KEY_ID } });
  if (key && verifyInboundToken(token, key.tokenHash)) {
    await client.orcaCatalogSyncKey.update({ where: { id: KEY_ID }, data: { lastUsedAt: now } });
    return { kind: "sync-key" };
  }
  const connector = await client.webhookConnector.findFirst({
    where: { inboundTokenHash: hashInboundToken(token), enabled: true, botUser: { active: true, isBot: true } },
    include: { botUser: { select: { name: true } } },
  });
  return connector ? { kind: "webhook", connectorId: connector.id, botName: connector.botUser.name } : null;
}

// ---------- HTTP 处理 ----------

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

class BodyTooLarge extends Error {}

async function readLimited(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 会话请求只接受同源（浏览器跨站请求一定带 Origin） */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}

export type SessionAuth = { id: string; isAdmin: boolean } | null;

export function syncTokenFromRequest(req: Request): string | null {
  return parseBearer(req.headers.get("authorization")) ?? (req.headers.get("x-oa-catalog-token")?.trim() || null);
}

/**
 * POST /api/im/webhooks/orca-catalog/sync
 * 鉴权：Authorization: Bearer <同步密钥 | 已启用机器人 Token>（或 X-OA-Catalog-Token），或已登录管理员的同源会话。
 */
export async function handleCatalogSync(
  req: Request,
  deps: { client: DbClient; session: () => Promise<SessionAuth>; onSaved?: () => void; now?: () => Date },
): Promise<Response> {
  const token = syncTokenFromRequest(req);
  let via: SyncVia;
  if (token) {
    const auth = await authenticateSyncToken(deps.client, token);
    if (!auth) return json({ error: "同步密钥无效：请在「设置 · Webhook 机器人 · Orca 模型目录」中复制最新的同步命令" }, 401);
    via = "token";
  } else {
    const user = await deps.session();
    if (!user) return json({ error: "缺少同步密钥：请在请求头携带 Authorization: Bearer <同步密钥>" }, 401);
    if (!user.isAdmin) return json({ error: "仅管理员可以导入 Orca 目录" }, 403);
    if (!sameOrigin(req)) return json({ error: "跨站请求已拒绝" }, 403);
    via = "session";
  }

  let raw: string;
  try {
    raw = await readLimited(req, MAX_SYNC_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLarge) return json({ error: `请求体超过 ${MAX_SYNC_BODY_BYTES / 1024} KB 上限` }, 413);
    return json({ error: "读取请求体失败" }, 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "请求体不是合法的 JSON" }, 400);
  }
  const parsed = parseSnapshot(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const saved = await saveSnapshot(deps.client, parsed.data, via, deps.now?.() ?? new Date());
  deps.onSaved?.();
  const customModelCount = await deps.client.orcaCustomModel.count();
  return json({ ok: true, via, ...saved, customModelCount });
}
