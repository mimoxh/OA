import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { parseInput } from "@/lib/oa/validate";

// 纯函数与常量可在客户端组件中 import；数据库函数只接受调用方传入的 client

export { AGENT_PRESETS, MODEL_SUGGESTIONS } from "./orca-catalog-shared";

/**
 * 思考强度（Effort）标识。各基座取值不同（Orca 目录中可见 none / minimal / low / medium / high / xhigh / max / ultra 等），
 * 以模型目录声明为准，这里只校验格式：小写字母开头，字母、数字、- 与 _，最长 24 个字符。
 */
export type Effort = string;
export const EFFORT_RE = /^[a-z][a-z0-9_-]{0,23}$/;

/** 由基座自身配置管理默认模型 / 强度的基座：metadata 留空时不会覆盖其配置 */
export const SELF_MANAGED_AGENT_HINT: Record<string, string> = {
  droid: "Droid 默认使用其自身配置的模型与强度",
  devin: "Devin 默认使用其自身配置的模型与强度",
};

/** 出站 payload.metadata；字段为 null 表示交给外部 Bot 自行决定 */
export type RunMetadata = { agent: string | null; model: string | null; effort: Effort | null };
export type RunConfigPatch = { agent?: string | null; model?: string | null; effort?: string | null };
export type ConnectorRunDefaults = { defaultAgent: string | null; defaultModel: string | null; defaultEffort: string | null };

export const EMPTY_RUN_METADATA: RunMetadata = { agent: null, model: null, effort: null };

export const AGENT_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const MODEL_RE = /^[A-Za-z0-9][\w.:/@+-]*$/;

const blank = (lower: boolean) => (v: unknown) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t ? (lower ? t.toLowerCase() : t) : null;
};

export const agentField = z.preprocess(
  blank(true),
  z.string().max(40, "基座标识不能超过 40 个字符").regex(AGENT_RE, "基座标识只能包含小写字母、数字和 . _ -").nullable().optional(),
);
export const modelField = z.preprocess(
  blank(false),
  z.string().max(120, "模型 ID 不能超过 120 个字符").regex(MODEL_RE, "模型 ID 只能包含字母、数字和 . _ - : / @ +").nullable().optional(),
);
export const effortField = z.preprocess(
  blank(true),
  z
    .string({ error: "思考强度格式不正确" })
    .regex(EFFORT_RE, "思考强度只能是小写字母开头的标识（如 low / high / max），最长 24 个字符")
    .nullable()
    .optional(),
);

export const runConfigPatchSchema = z.object({ agent: agentField, model: modelField, effort: effortField });

function clean(v: string | null | undefined): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function normalizeEffort(v: string | null | undefined): Effort | null {
  const t = clean(v)?.toLowerCase();
  return t && EFFORT_RE.test(t) ? t : null;
}

export function isEmptyRunConfig(v: RunConfigPatch | null | undefined): boolean {
  return !v || (!clean(v.agent) && !clean(v.model) && !normalizeEffort(v.effort));
}

/** 逐字段合并：会话级选择 > 机器人默认 > null（空白一律视为 null） */
export function resolveRunMetadata(defaults: ConnectorRunDefaults | null | undefined, override?: RunConfigPatch | null): RunMetadata {
  return {
    agent: clean(override?.agent) ?? clean(defaults?.defaultAgent),
    model: clean(override?.model) ?? clean(defaults?.defaultModel),
    effort: normalizeEffort(override?.effort) ?? normalizeEffort(defaults?.defaultEffort),
  };
}

export async function getConversationRunConfig(client: DbClient, conversationId: string): Promise<RunMetadata> {
  const row = await client.webhookConversationConfig.findUnique({ where: { conversationId } });
  return row ? { agent: clean(row.agent), model: clean(row.model), effort: normalizeEffort(row.effort) } : { ...EMPTY_RUN_METADATA };
}

/**
 * 局部更新会话级覆盖：undefined 保持不变，null / 空白清除该字段。
 * 合并后全部为空时删除记录（等价于恢复机器人默认）。
 */
export async function saveConversationRunConfig(
  client: DbClient,
  conversationId: string,
  userId: string | null,
  patch: RunConfigPatch,
): Promise<RunMetadata> {
  const v = parseInput(runConfigPatchSchema, patch);
  const current = await getConversationRunConfig(client, conversationId);
  const next: RunMetadata = {
    agent: v.agent === undefined ? current.agent : v.agent,
    model: v.model === undefined ? current.model : v.model,
    effort: v.effort === undefined ? current.effort : v.effort,
  };
  if (isEmptyRunConfig(next)) {
    await client.webhookConversationConfig.deleteMany({ where: { conversationId } });
    return { ...EMPTY_RUN_METADATA };
  }
  await client.webhookConversationConfig.upsert({
    where: { conversationId },
    create: { conversationId, ...next, updatedById: userId },
    update: { ...next, updatedById: userId },
  });
  return next;
}

export async function resetConversationRunConfig(client: DbClient, conversationId: string): Promise<RunMetadata> {
  await client.webhookConversationConfig.deleteMany({ where: { conversationId } });
  return { ...EMPTY_RUN_METADATA };
}

export type ChatRunBot = { connectorId: string; botUserId: string; name: string; avatarColor: string; defaults: RunMetadata };
export type ChatRunConfigContext = { bots: ChatRunBot[]; override: RunMetadata };

/** 会话中已启用的 Webhook 机器人；仅单聊 / 群聊 */
export async function listConversationWebhookBots(client: DbClient, conversationId: string): Promise<ChatRunBot[]> {
  const conv = await client.conversation.findUnique({ where: { id: conversationId }, select: { type: true } });
  if (!conv || (conv.type !== "DIRECT" && conv.type !== "GROUP")) return [];
  const connectors = await client.webhookConnector.findMany({
    where: { enabled: true, botUser: { active: true, isBot: true, imMemberships: { some: { conversationId } } } },
    orderBy: { createdAt: "asc" },
    include: { botUser: { select: { id: true, name: true, avatarColor: true } } },
  });
  return connectors.map((c) => ({
    connectorId: c.id,
    botUserId: c.botUserId,
    name: c.botUser.name,
    avatarColor: c.botUser.avatarColor,
    defaults: resolveRunMetadata(c),
  }));
}

/** 聊天页选择器上下文；会话内没有已启用的 Webhook 机器人时返回 null（不显示选择器） */
export async function getChatRunConfigContext(client: DbClient, conversationId: string): Promise<ChatRunConfigContext | null> {
  const bots = await listConversationWebhookBots(client, conversationId);
  if (!bots.length) return null;
  return { bots, override: await getConversationRunConfig(client, conversationId) };
}
