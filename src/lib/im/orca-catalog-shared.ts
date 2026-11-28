// Orca 基座 / 模型 / Effort 目录的共享类型与纯函数：服务端接口与客户端选择器共用，不得引入 Node 模块

/** 模型支持的思考强度；value 即出站 metadata.effort */
export type OrcaEffort = { value: string; label: string };

export type OrcaModel = {
  id: string;
  label: string;
  description: string | null;
  isDefault: boolean;
  efforts: OrcaEffort[];
  /** true 表示 Orca 已确认该模型的强度列表（为空即不支持调节强度）；false 表示未知 */
  effortsKnown: boolean;
  /** 模型声明的默认思考强度（只用于提示） */
  defaultEffort: string | null;
  /** 管理员在「Webhook 机器人」设置页手动维护的模型（不会被同步覆盖） */
  custom?: boolean;
};

/**
 * 模型列表来源：live / discovered 来自 Orca 模型目录（实时探测优先，回退离线发现结果）；
 * custom 表示只有手动维护的自定义模型；null 表示目录中没有该基座，界面使用静态预设并允许手动输入。
 */
export type OrcaModelSource = "live" | "discovered" | "custom" | null;

export type OrcaAgent = {
  id: string;
  label: string;
  /** orca agent installed 检测到（可启动）的基座 */
  installed: boolean;
  /** Orca 中设置的默认基座 */
  isDefault: boolean;
  modelSource: OrcaModelSource;
  models: OrcaModel[];
  /** Orca 中该基座当前配置的模型 / 强度（只用于提示） */
  configured: { model: string | null; effort: string | null } | null;
};

export type OrcaSourceStatus = {
  /** orca agent installed --json；disabled 表示已用 ORCA_CATALOG_LOCAL=off 关闭本机探测 */
  cli: "ok" | "unavailable" | "error" | "disabled";
  /** agent-model-catalog.db */
  catalog: "ok" | "missing" | "unreadable" | "invalid";
};

/**
 * 目录来源（优先级从高到低）：
 *   local  —— OA 与 Orca 在同一台电脑，实时读取本机 Orca；
 *   synced —— 读取运行 Orca 的电脑推送到 OA 数据库的快照（NAS / 容器部署）；
 *   preset —— 既无本机 Orca 也未同步过，使用静态预设。
 */
export type CatalogOrigin =
  | { kind: "local"; host: string | null }
  | { kind: "synced"; host: string; label: string | null; syncedAt: string; hostCount: number }
  | { kind: "preset" };

export type OrcaCatalog = {
  agents: OrcaAgent[];
  defaultAgent: string | null;
  status: OrcaSourceStatus;
  origin: CatalogOrigin;
  /** 已合并的手动维护模型数量 */
  customModelCount: number;
  /** 降级说明，界面以提示方式展示 */
  warnings: string[];
  fetchedAt: string;
};

/** 同步目录超过该时长未更新时提示（毫秒） */
export const SYNC_STALE_MS = 7 * 24 * 3600_000;

/** 尚未同步、也没有本机 Orca 时的引导文案 */
export const SYNC_GUIDE = "尚未同步 Orca 模型目录，当前为常用预设：请在「设置 · Webhook 机器人」复制同步命令到运行 Orca 的电脑执行，或手动添加常用模型";

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地时区的 YYYY-MM-DD HH:mm */
export function formatSyncTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 粗粒度相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

/** 状态行中的目录来源说明，例如「来源：已同步目录（office-pc · 2026-11-28 15:00，3 分钟前）」 */
export function originText(origin: CatalogOrigin | null | undefined, now: number = Date.now()): string {
  if (!origin || origin.kind === "preset") return "来源：常用预设（尚未同步 Orca 目录）";
  if (origin.kind === "local") return "来源：本机 Orca";
  const who = origin.label && origin.label !== origin.host ? `${origin.label}（${origin.host}）` : origin.host;
  const more = origin.hostCount > 1 ? ` 等 ${origin.hostCount} 台` : "";
  return `来源：已同步目录（${who}${more} · ${formatSyncTime(origin.syncedAt)}，${relativeTime(origin.syncedAt, now)}）`;
}

/** 分组标题：本机 Orca / 已同步 Orca */
export function originGroupLabel(origin: CatalogOrigin | null | undefined): string {
  return origin?.kind === "synced" ? "已同步 Orca" : "本机 Orca";
}

/** 未声明强度列表时的通用选项（与早期版本一致） */
export const DEFAULT_EFFORT_OPTIONS: OrcaEffort[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

/** 目录中没有某基座时的常用模型预设（仍可手动输入任意模型 ID） */
export const MODEL_SUGGESTIONS = ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-6-astra", "gpt-5.5-codex", "gemini-3-pro"];

/** 无法读取 Orca 时的兜底基座预设 */
export const AGENT_PRESETS = ["antigravity", "claude", "codex", "droid", "opencode2", "dsh", "devin"] as const;

export function findAgent(catalog: OrcaCatalog | null | undefined, agent: string | null | undefined): OrcaAgent | null {
  if (!catalog || !agent) return null;
  return catalog.agents.find((a) => a.id === agent) ?? null;
}

export function findModel(agent: OrcaAgent | null, model: string | null | undefined): OrcaModel | null {
  if (!agent || !model) return null;
  return agent.models.find((m) => m.id === model) ?? null;
}

export type ModelChoices = {
  /** 可选模型（目录真实模型；目录缺失时为静态预设） */
  models: { id: string; label: string; description: string | null; isDefault: boolean; custom?: boolean }[];
  source: OrcaModelSource | "preset";
};

/** 某基座的模型选项；未指定基座时也返回静态预设，供“跟随默认”场景手动挑选 */
export function modelChoices(catalog: OrcaCatalog | null | undefined, agent: string | null | undefined): ModelChoices {
  const a = findAgent(catalog, agent);
  if (a && a.models.length) return { models: a.models, source: a.modelSource };
  return { models: MODEL_SUGGESTIONS.map((id) => ({ id, label: id, description: null, isDefault: false })), source: "preset" };
}

export type EffortChoices = {
  efforts: OrcaEffort[];
  /** model：来自模型声明；none：模型明确不支持调节强度；generic：未知，使用通用选项 */
  source: "model" | "none" | "generic";
};

export function effortChoices(catalog: OrcaCatalog | null | undefined, agent: string | null | undefined, model: string | null | undefined): EffortChoices {
  const m = findModel(findAgent(catalog, agent), model);
  if (m?.efforts.length) return { efforts: m.efforts, source: "model" };
  if (m?.effortsKnown) return { efforts: [], source: "none" };
  return { efforts: DEFAULT_EFFORT_OPTIONS, source: "generic" };
}

/** 模型搜索：按 ID / 名称 / 描述做不区分大小写的包含匹配，空格分隔的多个词需全部命中 */
export function filterModels<T extends { id: string; label: string; description?: string | null }>(models: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return models;
  return models.filter((m) => {
    const hay = `${m.id} ${m.label} ${m.description ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** 基座显示名：目录中的名称优先，否则使用基座标识 */
export function agentLabel(catalog: OrcaCatalog | null | undefined, agent: string, fallback?: Record<string, string>): string {
  return findAgent(catalog, agent)?.label ?? fallback?.[agent] ?? agent;
}

export function effortLabel(efforts: OrcaEffort[], value: string): string {
  return efforts.find((e) => e.value === value)?.label ?? value;
}
