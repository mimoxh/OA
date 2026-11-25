"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { ConversationDTO, MessageDTO, UserLite } from "@/lib/im/types";
import { showDesktopNotification } from "@/lib/im/desktop-notify";
import { clearMobileNotifications, isMobileApp, showMobileNotification, type MobilePushChannelKey } from "@/lib/mobile-bridge";
import { randomId } from "@/lib/client-id";
import { subscribeRealtime, type RealtimeEvent } from "@/components/realtime/provider";
import {
  editMessageAction as editMessageActionRaw,
  markConversationRead as markConversationReadRaw,
  sendFileMessage as sendFileMessageRaw,
  sendMessage as sendMessageRaw,
  toggleMessageReaction as toggleMessageReactionRaw,
} from "@/app/(app)/messages/actions";
import type { ActionResult } from "@/lib/action";
import { handleStaleAction, isStaleActionError } from "@/lib/stale-action";

/** Server Action 抛错（网络中断、服务升级后 Action 不存在）时转成失败结果，避免发送中的气泡一直转圈 */
function safe<A extends unknown[], T>(fn: (...args: A) => Promise<ActionResult<T>>) {
  return async (...args: A): Promise<ActionResult<T>> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (isStaleActionError(e)) {
        handleStaleAction();
        return { ok: false, error: "" };
      }
      return { ok: false, error: "网络异常，请稍后重试" };
    }
  };
}
const sendMessage = safe(sendMessageRaw);
const sendFileMessage = safe(sendFileMessageRaw);
const editMessageAction = safe(editMessageActionRaw);
const toggleMessageReaction = safe(toggleMessageReactionRaw);
const markConversationRead = safe(markConversationReadRaw);

export type PendingMsg = {
  clientMsgId: string;
  kind?: "text" | "attachment";
  content: unknown;
  file?: File;
  text: string;
  replyToId: string | null;
  createdAt: string;
  failed: boolean;
};

export type MsgState = {
  items: MessageDTO[];
  hasMore: boolean;
  hasNewer?: boolean;
  loading: boolean;
  pending: PendingMsg[];
};
export type ThreadState = {
  root: MessageDTO | null;
  items: MessageDTO[];
  hasMore: boolean;
  loading: boolean;
};
export type GroupMember = UserLite & { role: string; lastReadSeq?: number };

type ImState = {
  meId: string | null;
  activeConvId: string | null;
  convs: Map<string, ConversationDTO>;
  messages: Map<string, MsgState>;
  threads: Map<string, ThreadState>;
  members: Map<string, GroupMember[]>;
  typing: Map<string, Map<string, number>>;
  online: Set<string>;
  drafts: Map<string, unknown>;
  loaded: boolean;
};

const state: ImState = {
  meId: null,
  activeConvId: null,
  convs: new Map(),
  messages: new Map(),
  threads: new Map(),
  members: new Map(),
  typing: new Map(),
  online: new Set(),
  drafts: new Map(),
  loaded: false,
};

// 派生缓存（每次 emit 前重算，保证 getSnapshot 引用稳定）
let sortedConvs: ConversationDTO[] = [];
let unreadTotal = 0;
const typingLists = new Map<string, string[]>();

const subs = new Set<() => void>();
function emit() {
  for (const l of [...subs]) l();
}
function subscribe(l: () => void) {
  subs.add(l);
  return () => subs.delete(l);
}

function sortConvs() {
  sortedConvs = [...state.convs.values()].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") ||
      b.createdAt.localeCompare(a.createdAt),
  );
  unreadTotal = sortedConvs.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
}

function putConv(dto: ConversationDTO) {
  state.convs.set(dto.id, dto);
  sortConvs();
}

function patchConv(id: string, patch: Partial<ConversationDTO>) {
  const cur = state.convs.get(id);
  if (!cur) return;
  state.convs.set(id, { ...cur, ...patch });
  sortConvs();
}

function putMessages(convId: string, patch: Partial<MsgState>) {
  const cur = state.messages.get(convId) ?? { items: [], hasMore: true, hasNewer: false, loading: false, pending: [] };
  state.messages.set(convId, { ...cur, ...patch });
}

function putThread(rootId: string, patch: Partial<ThreadState>) {
  const cur = state.threads.get(rootId) ?? { root: null, items: [], hasMore: false, loading: false };
  state.threads.set(rootId, { ...cur, ...patch });
}

function insertMessage(convId: string, msg: MessageDTO) {
  if (msg.threadRootId) {
    const ts = state.threads.get(msg.threadRootId);
    if (!ts) return;
    if (ts.items.some((m) => m.id === msg.id)) return;
    const items = [...ts.items];
    let i = items.length;
    while (i > 0 && items[i - 1].seq > msg.seq) i--;
    items.splice(i, 0, msg);
    putThread(msg.threadRootId, { items });
    return;
  }
  const ms = state.messages.get(convId);
  if (!ms || ms.hasNewer) return;
  if (ms.items.some((m) => m.id === msg.id)) return;
  let pending = ms.pending;
  if (msg.clientMsgId && pending.some((p) => p.clientMsgId === msg.clientMsgId)) {
    pending = pending.filter((p) => p.clientMsgId !== msg.clientMsgId);
  }
  const items = [...ms.items];
  // 按 seq 升序插入（一般即尾部）
  let i = items.length;
  while (i > 0 && items[i - 1].seq > msg.seq) i--;
  items.splice(i, 0, msg);
  putMessages(convId, { items, pending });
}

function applyUpdatedMessage(convId: string, msg: MessageDTO) {
  const ms = state.messages.get(convId);
  if (ms && ms.items.some((m) => m.id === msg.id)) {
    putMessages(convId, { items: ms.items.map((m) => (m.id === msg.id ? msg : m)) });
  }
  // 同步话题抽屉内的根消息或子回复
  if (state.threads.has(msg.id)) {
    putThread(msg.id, { root: msg });
  }
  if (msg.threadRootId && state.threads.has(msg.threadRootId)) {
    const ts = state.threads.get(msg.threadRootId)!;
    if (ts.items.some((m) => m.id === msg.id)) {
      putThread(msg.threadRootId, { items: ts.items.map((m) => (m.id === msg.id ? msg : m)) });
    }
  }
  const conv = state.convs.get(convId);
  if (conv?.lastMessage?.seq === msg.seq) {
    patchConv(convId, {
      lastMessage: { ...conv.lastMessage, text: msg.recalled ? "" : msg.text, recalled: msg.recalled },
    });
  }
}

function summarize(conv: ConversationDTO, msg: MessageDTO, meId: string | null): ConversationDTO {
  const fromMe = msg.sender?.id === meId;
  const lastReadSeq = fromMe ? Math.max(conv.lastReadSeq, msg.seq) : conv.lastReadSeq;
  return {
    ...conv,
    lastSeq: Math.max(conv.lastSeq, msg.seq),
    lastReadSeq,
    unread: Math.max(0, Math.max(conv.lastSeq, msg.seq) - lastReadSeq),
    lastMessageAt: msg.createdAt,
    lastMessage: {
      seq: msg.seq,
      type: msg.type,
      text: msg.recalled ? "" : msg.text,
      senderName: msg.sender?.name ?? null,
      recalled: msg.recalled,
      createdAt: msg.createdAt,
    },
  };
}

// ── 拉取 ──

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchConversation(convId: string): Promise<ConversationDTO | null> {
  const r = await fetchJson<{ conversation: ConversationDTO; members?: GroupMember[] | null }>(
    `/api/im/conversations/${convId}`,
  );
  if (!r) return null;
  if (r.members) state.members.set(convId, r.members);
  putConv(r.conversation);
  emit();
  return r.conversation;
}

export async function bootstrap() {
  const meId = state.meId;
  const r = await fetchJson<{ conversations: ConversationDTO[] }>("/api/im/conversations");
  // 响应回来前已退出/切换用户：丢弃过期结果
  if (!r || state.meId !== meId) return;
  for (const c of r.conversations) state.convs.set(c.id, c);
  sortConvs();
  state.loaded = true;
  emit();
  // 已加载消息流的会话补拉缺口
  for (const convId of state.messages.keys()) void syncAfter(convId);
}

export async function loadMessages(convId: string) {
  const ms = state.messages.get(convId);
  if (ms?.loading || (ms && ms.items.length)) return;
  putMessages(convId, { loading: true });
  emit();
  const r = await fetchJson<{ messages: MessageDTO[]; hasMore: boolean }>(
    `/api/im/conversations/${convId}/messages?limit=50`,
  );
  if (r) putMessages(convId, { items: r.messages, hasMore: r.hasMore, hasNewer: false, loading: false });
  else putMessages(convId, { loading: false });
  emit();
}

export async function reloadLatestMessages(convId: string) {
  putMessages(convId, { loading: true });
  emit();
  const r = await fetchJson<{ messages: MessageDTO[]; hasMore: boolean }>(
    `/api/im/conversations/${convId}/messages?limit=50`,
  );
  if (r) putMessages(convId, { items: r.messages, hasMore: r.hasMore, hasNewer: false, loading: false });
  else putMessages(convId, { loading: false });
  emit();
}

export async function loadMessagesAround(convId: string, seq: number): Promise<boolean> {
  const ms = state.messages.get(convId);
  if (ms && ms.items.some((m) => m.seq === seq)) return true;
  putMessages(convId, { loading: true });
  emit();
  const r = await fetchJson<{ messages: MessageDTO[]; hasMore: boolean; hasNewer?: boolean }>(
    `/api/im/conversations/${convId}/messages?around=${seq}&limit=50`,
  );
  if (r) {
    putMessages(convId, {
      items: r.messages,
      hasMore: r.hasMore,
      hasNewer: Boolean(r.hasNewer),
      loading: false,
    });
    emit();
    return r.messages.some((m) => m.seq === seq);
  }
  putMessages(convId, { loading: false });
  emit();
  return false;
}

export async function loadOlder(convId: string): Promise<void> {
  const ms = state.messages.get(convId);
  if (!ms || ms.loading || !ms.hasMore || !ms.items.length) return;
  putMessages(convId, { loading: true });
  emit();
  const before = ms.items[0].seq;
  const r = await fetchJson<{ messages: MessageDTO[]; hasMore: boolean }>(
    `/api/im/conversations/${convId}/messages?before=${before}&limit=50`,
  );
  const cur = state.messages.get(convId)!;
  if (r) putMessages(convId, { items: [...r.messages, ...cur.items], hasMore: r.hasMore, loading: false });
  else putMessages(convId, { loading: false });
  emit();
}

/** 断线/缺口补齐：按 seq 向后拉取直到无更多 */
export async function syncAfter(convId: string, fromSeq?: number) {
  const ms = state.messages.get(convId);
  if (!ms || !ms.items.length || ms.hasNewer) return;
  let after = fromSeq ?? ms.items[ms.items.length - 1].seq;
  for (;;) {
    const r = await fetchJson<{ messages: MessageDTO[]; hasMore: boolean }>(
      `/api/im/conversations/${convId}/messages?after=${after}&limit=100`,
    );
    if (!r || !r.messages.length) break;
    const cur = state.messages.get(convId);
    if (!cur) return;
    const mainIncoming = r.messages.filter((m) => !m.threadRootId);
    const threadIncoming = r.messages.filter((m) => !!m.threadRootId);
    if (mainIncoming.length) {
      const seen = new Set(cur.items.map((m) => m.id));
      const fresh = mainIncoming.filter((m) => !seen.has(m.id));
      if (fresh.length) {
        putMessages(convId, { items: [...cur.items, ...fresh].sort((a, b) => a.seq - b.seq) });
      }
    }
    for (const tm of threadIncoming) {
      insertMessage(convId, tm);
    }
    after = r.messages[r.messages.length - 1].seq;
    // 同步会话摘要
    const conv = state.convs.get(convId);
    if (conv && r.messages.length) {
      const last = r.messages[r.messages.length - 1];
      patchConv(convId, summarize(conv, last, state.meId));
    }
    emit();
    if (!r.hasMore) break;
  }
}

// ── 话题（Thread）──

export async function loadThread(convId: string, rootId: string) {
  putThread(rootId, { loading: true });
  emit();
  const r = await fetchJson<{ root: MessageDTO; messages: MessageDTO[]; hasMore: boolean }>(
    `/api/im/conversations/${convId}/threads/${rootId}?limit=50`,
  );
  if (r) {
    putThread(rootId, { root: r.root, items: r.messages, hasMore: r.hasMore, loading: false });
    applyUpdatedMessage(convId, r.root);
  } else {
    putThread(rootId, { loading: false });
  }
  emit();
}

export async function loadOlderThread(convId: string, rootId: string) {
  const ts = state.threads.get(rootId);
  if (!ts || ts.loading || !ts.hasMore || !ts.items.length) return;
  putThread(rootId, { loading: true });
  emit();
  const before = ts.items[0].seq;
  const r = await fetchJson<{ root: MessageDTO; messages: MessageDTO[]; hasMore: boolean }>(
    `/api/im/conversations/${convId}/threads/${rootId}?before=${before}&limit=50`,
  );
  const cur = state.threads.get(rootId);
  if (r && cur) {
    putThread(rootId, { items: [...r.messages, ...cur.items], hasMore: r.hasMore, loading: false });
  } else {
    putThread(rootId, { loading: false });
  }
  emit();
}

export async function sendThreadText(convId: string, rootId: string, content: unknown) {
  const clientMsgId = randomId();
  const r = await sendMessage({ conversationId: convId, clientMsgId, content, threadRootId: rootId });
  if (r.ok) {
    insertMessage(convId, r.data);
    const conv = state.convs.get(convId);
    if (conv) putConv(summarize(conv, r.data, state.meId));
    emit();
    return true;
  }
  if (r.error) toast.error(r.error);
  return false;
}

export async function sendThreadAttachment(convId: string, rootId: string, file: File) {
  const clientMsgId = randomId();
  const attachmentId = await uploadAttachment(convId, file);
  if (!attachmentId) return false;
  const r = await sendFileMessage({ conversationId: convId, attachmentId, clientMsgId, threadRootId: rootId });
  if (r.ok) {
    insertMessage(convId, r.data);
    const conv = state.convs.get(convId);
    if (conv) putConv(summarize(conv, r.data, state.meId));
    emit();
    return true;
  }
  if (r.error) toast.error(r.error);
  return false;
}

// ── 发送 / 编辑 / 表态 ──

export async function sendText(convId: string, content: unknown, replyToId: string | null) {
  const clientMsgId = randomId();
  const text = extractText(content);
  const ms = state.messages.get(convId) ?? { items: [], hasMore: true, hasNewer: false, loading: false, pending: [] };
  state.messages.set(convId, ms);
  putMessages(convId, {
    pending: [...ms.pending, { clientMsgId, content, text, replyToId, createdAt: new Date().toISOString(), failed: false }],
  });
  emit();
  await doSend(convId, clientMsgId, content, replyToId);
}

async function doSend(convId: string, clientMsgId: string, content: unknown, replyToId: string | null) {
  const r = await sendMessage({ conversationId: convId, clientMsgId, content, replyToId: replyToId ?? undefined });
  const ms = state.messages.get(convId);
  if (!ms) return;
  if (r.ok) {
    const dto = r.data;
    // message.new 可能已先到：去重 + 移除 pending
    const items = ms.hasNewer || ms.items.some((m) => m.id === dto.id)
      ? ms.items
      : [...ms.items, dto].sort((a, b) => a.seq - b.seq);
    putMessages(convId, { items, pending: ms.pending.filter((p) => p.clientMsgId !== clientMsgId) });
    const conv = state.convs.get(convId);
    if (conv) putConv(summarize(conv, dto, state.meId));
  } else {
    putMessages(convId, {
      pending: ms.pending.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: true } : p)),
    });
    if (r.error) toast.error(r.error);
  }
  emit();
}

async function readImageDims(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return null;
  try {
    const bmp = await createImageBitmap(file);
    const res = { width: bmp.width, height: bmp.height };
    bmp.close();
    return res;
  } catch {
    return null;
  }
}

async function uploadAttachment(convId: string, file: File): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("conversationId", convId);
    const dims = await readImageDims(file);
    if (dims) {
      form.append("width", String(dims.width));
      form.append("height", String(dims.height));
    }
    const res = await fetch("/api/im/upload", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !data.id) {
      toast.error(data.error || "文件上传失败");
      return null;
    }
    return data.id;
  } catch {
    toast.error("网络异常，文件上传失败");
    return null;
  }
}

export async function sendAttachment(convId: string, file: File, replyToId: string | null) {
  const clientMsgId = randomId();
  const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
  const text = isImage ? `正在上传图片 ${file.name}…` : `正在上传文件 ${file.name}…`;
  const ms = state.messages.get(convId) ?? { items: [], hasMore: true, hasNewer: false, loading: false, pending: [] };
  state.messages.set(convId, ms);
  putMessages(convId, {
    pending: [
      ...ms.pending,
      { clientMsgId, kind: "attachment", content: null, file, text, replyToId, createdAt: new Date().toISOString(), failed: false },
    ],
  });
  emit();
  await doSendAttachment(convId, clientMsgId, file, replyToId);
}

async function doSendAttachment(convId: string, clientMsgId: string, file: File, replyToId: string | null) {
  const markFailed = (errMsg?: string) => {
    const cur = state.messages.get(convId);
    if (!cur) return;
    putMessages(convId, {
      pending: cur.pending.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: true } : p)),
    });
    if (errMsg) toast.error(errMsg);
    emit();
  };

  const attachmentId = await uploadAttachment(convId, file);
  if (!attachmentId) {
    markFailed();
    return;
  }

  const r = await sendFileMessage({
    conversationId: convId,
    attachmentId,
    clientMsgId,
    replyToId: replyToId ?? undefined,
  });
  const ms = state.messages.get(convId);
  if (!ms) return;
  if (r.ok) {
    const dto = r.data;
    const items = ms.hasNewer || ms.items.some((m) => m.id === dto.id)
      ? ms.items
      : [...ms.items, dto].sort((a, b) => a.seq - b.seq);
    putMessages(convId, { items, pending: ms.pending.filter((p) => p.clientMsgId !== clientMsgId) });
    const conv = state.convs.get(convId);
    if (conv) putConv(summarize(conv, dto, state.meId));
    emit();
  } else {
    markFailed(r.error);
  }
}

export async function editMsg(convId: string, messageId: string, content: unknown): Promise<boolean> {
  const r = await editMessageAction({ messageId, content });
  if (r.ok) {
    applyUpdatedMessage(convId, r.data);
    emit();
    return true;
  }
  if (r.error) toast.error(r.error);
  return false;
}

export async function toggleReactionAction(convId: string, messageId: string, emoji: string) {
  const r = await toggleMessageReaction({ messageId, emoji });
  if (r.ok) {
    applyUpdatedMessage(convId, r.data.message);
    emit();
  } else if (r.error) {
    toast.error(r.error);
  }
}

export function retryPending(convId: string, clientMsgId: string) {
  const ms = state.messages.get(convId);
  const p = ms?.pending.find((x) => x.clientMsgId === clientMsgId);
  if (!p) return;
  putMessages(convId, {
    pending: ms!.pending.map((x) => (x.clientMsgId === clientMsgId ? { ...x, failed: false } : x)),
  });
  emit();
  if (p.kind === "attachment" && p.file) {
    void doSendAttachment(convId, clientMsgId, p.file, p.replyToId);
  } else {
    void doSend(convId, clientMsgId, p.content, p.replyToId);
  }
}

export function discardPending(convId: string, clientMsgId: string) {
  const ms = state.messages.get(convId);
  if (!ms) return;
  putMessages(convId, { pending: ms.pending.filter((p) => p.clientMsgId !== clientMsgId) });
  emit();
}

// ── 已读 ──

export async function markRead(convId: string, seq: number) {
  const conv = state.convs.get(convId);
  if (conv && seq > conv.lastReadSeq) patchConv(convId, { lastReadSeq: seq, unread: Math.max(0, conv.lastSeq - seq) });
  emit();
  await markConversationRead({ conversationId: convId, seq });
}

// ── 成员 & 激活会话 ──

export function setActiveConversation(convId: string | null) {
  state.activeConvId = convId;
}

export async function loadMembers(convId: string): Promise<GroupMember[] | null> {
  const cached = state.members.get(convId);
  if (cached) return cached;
  const r = await fetchJson<{ members?: GroupMember[] | null }>(`/api/im/conversations/${convId}`);
  if (r?.members) {
    state.members.set(convId, r.members);
    emit();
    return r.members;
  }
  return null;
}

export function setMembers(convId: string, members: GroupMember[]) {
  state.members.set(convId, members);
  emit();
}

/** 服务端首屏数据注入（不覆盖实时更新的较新数据） */
export function seedConversation(dto: ConversationDTO) {
  if (!state.convs.has(dto.id)) {
    state.convs.set(dto.id, dto);
    sortConvs();
    emit();
  }
}

export function seedMembers(convId: string, members: GroupMember[]) {
  if (!state.members.has(convId)) {
    state.members.set(convId, members);
    emit();
  }
}

// ── 草稿 ──

export function getDraft(convId: string): unknown {
  return state.drafts.get(convId);
}
export function setDraft(convId: string, content: unknown) {
  if (content == null) state.drafts.delete(convId);
  else state.drafts.set(convId, content);
}

// ── 事件 ──

function maybeNotifyMessage(convId: string, msg: MessageDTO) {
  // 手机 App 内改用服务端算好的 push.notify（见 maybeNotifyPush），与后台服务的提醒内容一致
  if (isMobileApp()) return;
  const meId = state.meId;
  if (!meId || msg.type === "SYSTEM" || msg.sender?.id === meId) return;
  const conv = state.convs.get(convId);
  const mentionedMe = msg.mentions.includes(meId) || msg.mentions.includes("all");
  if (conv?.muted && !mentionedMe) return;
  const hidden = typeof document !== "undefined" && document.hidden;
  if (!hidden && state.activeConvId === convId) return;

  const title = conv ? conv.name : (msg.sender?.name ?? "新消息");
  const prefix = conv?.type === "GROUP" && msg.sender?.name ? `${msg.sender.name}：` : "";
  const body = `${mentionedMe ? "[有人@你] " : ""}${prefix}${msg.text || "发来一条消息"}`;
  showDesktopNotification({
    title,
    body,
    url: `/messages/${convId}`,
    tag: `im-${convId}`,
  });
}

type PushNotifyPayload = {
  conversationId: string;
  channel: MobilePushChannelKey;
  title: string;
  body: string;
  path: string;
};

/**
 * App 在前台时的提醒（只有 App 内页面会收到 push.notify）。退到后台后由原生后台服务提醒，这里不再重复；
 * 停在该会话时不提醒；电脑端正在使用时服务端会标记 silent。
 */
function maybeNotifyPush(e: RealtimeEvent) {
  const n = e.notification as PushNotifyPayload | undefined;
  if (!n?.conversationId || e.silent === true) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (state.activeConvId === n.conversationId) return;
  void showMobileNotification({ conversationId: n.conversationId, title: n.title, body: n.body, path: n.path, channel: n.channel });
}

function handleEvent(e: RealtimeEvent) {
  const meId = state.meId;
  switch (e.type) {
    case "push.notify":
      maybeNotifyPush(e);
      break;
    case "push.clear":
      if (typeof e.conversationId === "string") void clearMobileNotifications(e.conversationId);
      break;
    case "message.new": {
      const convId = e.conversationId as string;
      const msg = e.message as MessageDTO;
      const conv = state.convs.get(convId);
      if (conv) {
        putConv(summarize(conv, msg, meId));
      } else {
        void fetchConversation(convId);
      }
      // 服务端发消息时顺带把发送者的 lastReadSeq 推进到该 seq，但不另发 read 事件（卡片/系统消息的已读归属不同，跳过）
      const senderId = msg.sender?.id;
      if (senderId && senderId !== meId && msg.type !== "CARD" && msg.type !== "SYSTEM") {
        const cur = state.convs.get(convId);
        if (cur?.type === "DIRECT" && cur.peerId === senderId && (cur.peerLastReadSeq ?? 0) < msg.seq) {
          patchConv(convId, { peerLastReadSeq: msg.seq });
        }
        const members = state.members.get(convId);
        if (members?.some((m) => m.id === senderId && (m.lastReadSeq ?? 0) < msg.seq)) {
          state.members.set(
            convId,
            members.map((m) => (m.id === senderId ? { ...m, lastReadSeq: msg.seq } : m)),
          );
        }
      }
      const ms = state.messages.get(convId);
      if (ms && !ms.hasNewer) {
        const lastSeq = ms.items.length ? ms.items[ms.items.length - 1].seq : 0;
        insertMessage(convId, msg);
        if (!msg.threadRootId && msg.seq > lastSeq + 1) void syncAfter(convId, lastSeq);
      } else if (msg.threadRootId) {
        insertMessage(convId, msg);
      }
      maybeNotifyMessage(convId, msg);
      emit();
      break;
    }
    case "message.updated": {
      const convId = e.conversationId as string;
      const msg = e.message as MessageDTO;
      applyUpdatedMessage(convId, msg);
      emit();
      break;
    }
    case "conversation.updated": {
      const convId = e.conversationId as string;
      void fetchConversation(convId);
      // 已加载成员列表的会话同步刷新成员
      if (state.members.has(convId)) {
        void fetchJson<{ members?: GroupMember[] | null }>(`/api/im/conversations/${convId}`).then((r) => {
          if (r?.members) {
            state.members.set(convId, r.members);
            emit();
          }
        });
      }
      break;
    }
    case "conversation.removed": {
      const convId = e.conversationId as string;
      if (state.convs.delete(convId)) sortConvs();
      state.messages.delete(convId);
      state.members.delete(convId);
      state.typing.delete(convId);
      typingLists.delete(convId);
      emit();
      window.dispatchEvent(new CustomEvent("im:conversation-removed", { detail: convId }));
      toast.info("你已不在该群聊中");
      break;
    }
    case "read": {
      const convId = e.conversationId as string;
      const seq = e.seq as number;
      const readerId = e.userId as string | undefined;
      const conv = state.convs.get(convId);
      if (!readerId || readerId === meId) {
        if (conv) patchConv(convId, { lastReadSeq: Math.max(conv.lastReadSeq, seq), unread: Math.max(0, conv.lastSeq - seq) });
      } else {
        if (conv?.type === "DIRECT" && conv.peerId === readerId) {
          patchConv(convId, { peerLastReadSeq: Math.max(conv.peerLastReadSeq ?? 0, seq) });
        }
        const members = state.members.get(convId);
        if (members) {
          state.members.set(
            convId,
            members.map((m) => (m.id === readerId ? { ...m, lastReadSeq: Math.max(m.lastReadSeq ?? 0, seq) } : m)),
          );
        }
      }
      emit();
      break;
    }
    case "typing": {
      const convId = e.conversationId as string;
      const userId = e.userId as string;
      if (userId === meId) break;
      let m = state.typing.get(convId);
      if (!m) {
        m = new Map();
        state.typing.set(convId, m);
      }
      m.set(userId, Date.now() + 5000);
      refreshTypingList(convId);
      emit();
      setTimeout(() => {
        const cur = state.typing.get(convId);
        if (cur) {
          for (const [uid, exp] of cur) if (exp < Date.now()) cur.delete(uid);
          refreshTypingList(convId);
          emit();
        }
      }, 5100);
      break;
    }
    case "presence.snapshot": {
      state.online = new Set(e.userIds as string[]);
      emit();
      break;
    }
    case "presence": {
      const userId = e.userId as string;
      const next = new Set(state.online);
      if (e.online) next.add(userId);
      else next.delete(userId);
      state.online = next;
      emit();
      break;
    }
    case "reconnected": {
      void bootstrap();
      break;
    }
  }
}

function refreshTypingList(convId: string) {
  const m = state.typing.get(convId);
  const now = Date.now();
  const list = m ? [...m.entries()].filter(([, exp]) => exp > now).map(([uid]) => uid) : [];
  typingLists.set(convId, list);
}

// ── 文本提取（pending 预览用，与服务端同规则） ──

function extractText(content: unknown): string {
  try {
    const doc = content as { content?: { content?: { type: string; text?: string; attrs?: { label?: string } }[] }[] };
    return (doc.content ?? [])
      .map((p) =>
        (p.content ?? []).map((n) => (n.type === "text" ? (n.text ?? "") : n.type === "mention" ? `@${n.attrs?.label ?? "成员"}` : "\n")).join(""),
      )
      .join("\n");
  } catch {
    return "";
  }
}

// ── hooks ──

let hooksInstalled = false;

export function initIm(meId: string) {
  if (!hooksInstalled) {
    hooksInstalled = true;
    subscribeRealtime(handleEvent);
    window.addEventListener("focus", () => void bootstrap());
  }
  if (state.meId === meId) return;
  // 首次初始化时不清空：子组件 effect 先于本调用执行，可能已写入当前用户的会话/成员（如直接打开 /messages/[id]）
  if (state.meId !== null) resetIm();
  state.meId = meId;
  void bootstrap();
}

/** 清空全部会话态（退出登录/切换用户时调用） */
export function resetIm() {
  state.meId = null;
  state.activeConvId = null;
  state.convs.clear();
  state.messages.clear();
  state.threads.clear();
  state.members.clear();
  state.typing.clear();
  typingLists.clear();
  state.online = new Set();
  state.drafts.clear();
  state.loaded = false;
  sortConvs();
  emit();
}

export function useConversations(): { list: ConversationDTO[]; loaded: boolean } {
  const list = useSyncExternalStore(subscribe, () => sortedConvs, () => sortedConvs);
  const loaded = useSyncExternalStore(subscribe, () => state.loaded, () => false);
  return { list, loaded };
}

export function useConversation(convId: string): ConversationDTO | undefined {
  return useSyncExternalStore(subscribe, () => state.convs.get(convId), () => undefined);
}

export function useConvMessages(convId: string): MsgState | undefined {
  return useSyncExternalStore(subscribe, () => state.messages.get(convId), () => undefined);
}

export function useThread(rootId: string | null): ThreadState | undefined {
  return useSyncExternalStore(subscribe, () => (rootId ? state.threads.get(rootId) : undefined), () => undefined);
}

export function useGroupMembers(convId: string): GroupMember[] | undefined {
  return useSyncExternalStore(subscribe, () => state.members.get(convId), () => undefined);
}

export function useTypingIds(convId: string): string[] {
  return useSyncExternalStore(subscribe, () => typingLists.get(convId) ?? EMPTY, () => EMPTY);
}
const EMPTY: string[] = [];

export function useOnline(userId: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => (userId ? state.online.has(userId) : false), () => false);
}

export function useTotalUnread(): number {
  return useSyncExternalStore(subscribe, () => unreadTotal, () => 0);
}

export function getMeId(): string | null {
  return state.meId;
}
