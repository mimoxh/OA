import { BOTS, type BotKey } from "@/lib/im/bots";
import type { MessageKind } from "@/lib/im/types";
import type { PushChannel, PushNotification } from "./types";

/**
 * 推送规则（纯函数，单元测试覆盖）：给定一条新消息、所在会话和成员，算出每个接收人是否提醒、标题、摘要和渠道。
 * 与网页端 store.ts 的 maybeNotifyMessage 保持同一套判断：跳过发送者、系统消息、免打扰但未被 @ 的会话。
 */

export type PushConversation = {
  id: string;
  type: "DIRECT" | "GROUP" | "BOT";
  name: string | null;
  botKey: string | null;
};

export type PushMessage = {
  id: string;
  seq: number;
  type: MessageKind;
  senderId: string | null;
  senderName: string | null;
  text: string;
  content: unknown;
  mentions: string[];
  recalled?: boolean;
  createdAt: Date | string;
};

export type PushRecipient = {
  userId: string;
  muted: boolean;
  isBot: boolean;
  active: boolean;
};

export const MENTION_PREFIX = "[有人@我] ";
export const MENTION_ALL_PREFIX = "[@所有人] ";
const BODY_MAX = 100;

function clip(s: string, max = BODY_MAX) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function field(content: unknown, key: string): string | null {
  if (!content || typeof content !== "object") return null;
  const v = (content as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 消息摘要：文字取正文，图片 / 文件给类型标记，卡片用卡片标题 */
export function summarizeMessage(msg: Pick<PushMessage, "type" | "text" | "content" | "recalled">): string {
  if (msg.recalled) return "撤回了一条消息";
  switch (msg.type) {
    case "IMAGE":
      return "[图片]";
    case "FILE": {
      const name = field(msg.content, "filename") ?? msg.text.trim();
      return name ? `[文件] ${clip(name, 60)}` : "[文件]";
    }
    case "CARD":
      return clip(field(msg.content, "title") ?? msg.text) || "[卡片消息]";
    default:
      return clip(msg.text) || "发来一条消息";
  }
}

export function conversationTitle(conv: PushConversation, senderName: string | null): string {
  if (conv.type === "DIRECT") return senderName ?? "新消息";
  if (conv.type === "BOT") return (BOTS[(conv.botKey ?? "system") as BotKey] ?? BOTS.system).name;
  return conv.name?.trim() || "群聊";
}

export function mentionKind(mentions: string[], userId: string): "user" | "all" | null {
  if (mentions.includes(userId)) return "user";
  if (mentions.includes("all")) return "all";
  return null;
}

export function pushChannel(conv: PushConversation, msg: Pick<PushMessage, "type" | "senderId">, mentioned: boolean): PushChannel {
  if (mentioned) return "mention";
  if (conv.type === "BOT" || (msg.type === "CARD" && !msg.senderId)) return "system";
  return conv.type === "DIRECT" ? "dm" : "group";
}

/** 单个接收人是否提醒（不含渲染），供补拉接口和派发共用 */
export function shouldPush(conv: PushConversation, msg: PushMessage, r: PushRecipient): boolean {
  if (msg.type === "SYSTEM" || msg.recalled) return false;
  if (!r.active || r.isBot) return false;
  if (msg.senderId && r.userId === msg.senderId) return false;
  if (r.muted && !mentionKind(msg.mentions, r.userId)) return false;
  return true;
}

export function buildNotification(conv: PushConversation, msg: PushMessage, userId: string): PushNotification {
  const mention = mentionKind(msg.mentions, userId);
  const summary = summarizeMessage(msg);
  const withSender = conv.type === "GROUP" && msg.senderName ? `${msg.senderName}：${summary}` : summary;
  const prefix = mention === "user" ? MENTION_PREFIX : mention === "all" ? MENTION_ALL_PREFIX : "";
  return {
    userId,
    conversationId: conv.id,
    messageId: msg.id,
    seq: msg.seq,
    channel: pushChannel(conv, msg, !!mention),
    title: conversationTitle(conv, msg.senderName),
    body: prefix + withSender,
    path: `/messages/${conv.id}`,
    mentioned: !!mention,
    sentAt: (typeof msg.createdAt === "string" ? new Date(msg.createdAt) : msg.createdAt).toISOString(),
    count: 1,
  };
}

export function computePushNotifications(conv: PushConversation, msg: PushMessage, recipients: PushRecipient[]): PushNotification[] {
  const seen = new Set<string>();
  const out: PushNotification[] = [];
  for (const r of recipients) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    if (shouldPush(conv, msg, r)) out.push(buildNotification(conv, msg, r.userId));
  }
  return out;
}

/**
 * 补拉汇总：同一会话多条未读合并成一条（标题不变，摘要取最新一条并标注条数；任一条 @我 则走 @我 渠道）。
 * 输入按 seq 升序。
 */
export function collapseByConversation(list: PushNotification[]): PushNotification[] {
  const byConv = new Map<string, PushNotification>();
  for (const n of list) {
    const prev = byConv.get(n.conversationId);
    if (!prev) {
      byConv.set(n.conversationId, { ...n });
      continue;
    }
    const mentioned = prev.mentioned || n.mentioned;
    byConv.set(n.conversationId, {
      ...n,
      mentioned,
      channel: mentioned ? "mention" : n.channel,
      count: prev.count + 1,
    });
  }
  return [...byConv.values()].map((n) => (n.count > 1 ? { ...n, body: `[${n.count}条] ${n.body}` } : n));
}
