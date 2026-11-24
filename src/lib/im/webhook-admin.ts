import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { encryptSecret, generateInboundToken, parseHeadersJson, validateOutboundUrl } from "./webhook-crypto";

export const BOT_ROLE_KEY = "webhook_bot";
/** 非 bcrypt 格式，bcrypt.compare 恒为 false；登录入口另有 isBot 拦截 */
export const BOT_PASSWORD_HASH = "!webhook-bot:login-disabled";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确");
const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label}不能超过 ${max} 字`).optional();

const baseSchema = z.object({
  name: z.string().trim().min(1, "请填写机器人名称").max(30, "名称不能超过 30 字"),
  avatarColor: color,
  title: optionalText(30, "副标题"),
  description: optionalText(200, "简介"),
  triggerMode: z.enum(["mention_only", "all"]).default("mention_only"),
});

export const createBotSchema = baseSchema.extend({
  outboundUrl: z.string().trim().min(1, "请填写 Outbound URL").max(2000, "Outbound URL 过长"),
  outboundSecret: z.string().max(500, "Secret 过长").optional(),
  outboundHeaders: z.string().max(10000, "自定义 Header 过长").optional(),
});

export const updateBotSchema = baseSchema.extend({
  id: z.string().min(1),
  /** 留空表示不修改 */
  outboundUrl: z.string().trim().max(2000, "Outbound URL 过长").optional(),
  outboundSecret: z.string().max(500, "Secret 过长").optional(),
  outboundHeaders: z.string().max(10000, "自定义 Header 过长").optional(),
  clearSecret: z.boolean().optional(),
  clearHeaders: z.boolean().optional(),
});

export type CreateBotInput = z.output<typeof createBotSchema>;
export type UpdateBotInput = z.output<typeof updateBotSchema>;

async function ensureBotRole(client: DbClient) {
  return client.role.upsert({
    where: { key: BOT_ROLE_KEY },
    create: { key: BOT_ROLE_KEY, name: "Webhook 机器人", description: "Webhook 机器人影子账号专用，无任何业务权限", permissions: "[]", system: true },
    update: {},
  });
}

function encryptHeaders(raw: string | undefined): string | null {
  const headers = parseHeadersJson(raw);
  return Object.keys(headers).length ? encryptSecret(JSON.stringify(headers)) : null;
}

/** 单事务创建 User(isBot) + WebhookConnector；返回仅此一次可见的明文 Token */
export async function createWebhookBot(client: DbClient, actorId: string | null, v: CreateBotInput) {
  const url = validateOutboundUrl(v.outboundUrl);
  const headers = encryptHeaders(v.outboundHeaders);
  const role = await ensureBotRole(client);
  const user = await client.user.create({
    data: {
      email: `bot-${randomBytes(8).toString("hex")}@webhook.bot.invalid`,
      name: v.name,
      passwordHash: BOT_PASSWORD_HASH,
      isBot: true,
      roleId: role.id,
      avatarColor: v.avatarColor,
      title: v.title || null,
    },
  });
  const token = generateInboundToken();
  const connector = await client.webhookConnector.create({
    data: {
      botUserId: user.id,
      description: v.description || null,
      outboundUrl: encryptSecret(url),
      outboundSecret: v.outboundSecret?.trim() ? encryptSecret(v.outboundSecret.trim()) : null,
      outboundHeaders: headers,
      triggerMode: v.triggerMode,
      inboundTokenHash: token.hash,
      inboundTokenPrefix: token.prefix,
      createdById: actorId,
    },
  });
  return { connectorId: connector.id, botUserId: user.id, token: token.token };
}

async function requireConnector(client: DbClient, id: string) {
  const c = await client.webhookConnector.findUnique({ where: { id } });
  if (!c) throw new Error("Webhook 机器人不存在");
  return c;
}

export async function updateWebhookBot(client: DbClient, v: UpdateBotInput) {
  const c = await requireConnector(client, v.id);
  const data: Record<string, unknown> = { description: v.description || null, triggerMode: v.triggerMode };
  if (v.outboundUrl) data.outboundUrl = encryptSecret(validateOutboundUrl(v.outboundUrl));
  if (v.clearSecret) data.outboundSecret = null;
  else if (v.outboundSecret?.trim()) data.outboundSecret = encryptSecret(v.outboundSecret.trim());
  if (v.clearHeaders) data.outboundHeaders = null;
  else if (v.outboundHeaders?.trim()) data.outboundHeaders = encryptHeaders(v.outboundHeaders);
  await client.webhookConnector.update({ where: { id: c.id }, data });
  await client.user.update({
    where: { id: c.botUserId },
    data: { name: v.name, avatarColor: v.avatarColor, title: v.title || null },
  });
}

/** 启停联动：连接器 enabled 与影子账号 active 同步，停用后不再出现在通讯录/选人中 */
export async function setWebhookBotEnabled(client: DbClient, id: string, enabled: boolean) {
  const c = await requireConnector(client, id);
  await client.webhookConnector.update({ where: { id: c.id }, data: { enabled } });
  await client.user.update({ where: { id: c.botUserId }, data: { active: enabled } });
}

export async function rotateWebhookToken(client: DbClient, id: string) {
  const c = await requireConnector(client, id);
  const token = generateInboundToken();
  await client.webhookConnector.update({ where: { id: c.id }, data: { inboundTokenHash: token.hash, inboundTokenPrefix: token.prefix } });
  return { connectorId: c.id, token: token.token };
}

/**
 * 删除连接器（级联删除投递日志）。影子账号保留为停用状态，
 * 使历史消息仍能显示机器人名称与头像。
 */
export async function deleteWebhookBot(client: DbClient, id: string) {
  const c = await requireConnector(client, id);
  await client.webhookConnector.delete({ where: { id: c.id } });
  await client.user.update({ where: { id: c.botUserId }, data: { active: false } });
  return { botUserId: c.botUserId };
}
