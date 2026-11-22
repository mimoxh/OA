"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { ConversationDTO, MessageDTO, UserLite } from "@/lib/im/types";
import { subscribeRealtime, type RealtimeEvent } from "@/components/realtime/provider";
import { markConversationRead, sendFileMessage, sendMessage } from "@/app/(app)/messages/actions";

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

export type MsgState = { items: MessageDTO[]; hasMore: boolean; loading: boolean; pending: PendingMsg[] };
export type GroupMember = UserLite & { role: string };

type ImState = {
  meId: string | null;
  convs: Map<string, ConversationDTO>;
  messages: Map<string, MsgState>;
  members: Map<string, GroupMember[]>;
  typing: Map<string, Map<string, number>>;
  online: Set<string>;
  drafts: Map<string, unknown>;
  loaded: boolean;
};

const state: ImState = {
  meId: null,
  convs: new Map(),
  messages: new Map(),
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
  const cur = state.messages.get(convId) ?? { items: [], hasMore: true, loading: false, pending: [] };
  state.messages.set(convId, { ...cur, ...patch });
}

function insertMessage(convId: string, msg: MessageDTO) {
  const ms = state.messages.get(convId);
  if (!ms) return;
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

function summarize(conv: ConversationDTO, msg: MessageDTO, meId: string | null): ConversationDTO {
  const fromMe = msg.sender?.id === meId;
  const lastReadSeq = fromMe ? Math.max(conv.lastReadSeq, msg.seq) : conv.lastReadSeq;
  return {
    ...conv,
    lastSeq: msg.seq,
    lastReadSeq,
    unread: Math.max(0, msg.seq - lastReadSeq),
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
  if (r) putMessages(convId, { items: r.messages, hasMore: r.hasMore, loading: false });
  else putMessages(convId, { loading: false });
  emit();
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
  if (!ms || !ms.items.length) return;
  let after = fromSeq ?? ms.items[ms.items.length - 1].seq;
  for (;;) {
    const r = await fetchJson<{ messages: MessageDTO[]; hasMore: boolean }>(
      `/api/im/conversations/${convId}/messages?after=${after}&limit=100`,
    );
    if (!r || !r.messages.length) break;
    const cur = state.messages.get(convId);
    if (!cur) return;
    const seen = new Set(cur.items.map((m) => m.id));
    const fresh = r.messages.filter((m) => !seen.has(m.id));
    if (fresh.length) {
      putMessages(convId, { items: [...cur.items, ...fresh].sort((a, b) => a.seq - b.seq) });
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

// ── 发送 ──

export async function sendText(convId: string, content: unknown, replyToId: string | null) {
  const clientMsgId = crypto.randomUUID();
  const text = extractText(content);
  const ms = state.messages.get(convId) ?? { items: [], hasMore: true, loading: false, pending: [] };
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
    const items = ms.items.some((m) => m.id === dto.id) ? ms.items : [...ms.items, dto].sort((a, b) => a.seq - b.seq);
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

export async function sendAttachment(convId: string, file: File, replyToId: string | null) {
  const clientMsgId = crypto.randomUUID();
  const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
  const text = isImage ? `正在上传图片 ${file.name}…` : `正在上传文件 ${file.name}…`;
  const ms = state.messages.get(convId) ?? { items: [], hasMore: true, loading: false, pending: [] };
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

  let attachmentId: string;
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
      markFailed(data.error || "文件上传失败");
      return;
    }
    attachmentId = data.id;
  } catch {
    markFailed("网络异常，文件上传失败");
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
    const items = ms.items.some((m) => m.id === dto.id) ? ms.items : [...ms.items, dto].sort((a, b) => a.seq - b.seq);
    putMessages(convId, { items, pending: ms.pending.filter((p) => p.clientMsgId !== clientMsgId) });
    const conv = state.convs.get(convId);
    if (conv) putConv(summarize(conv, dto, state.meId));
    emit();
  } else {
    markFailed(r.error);
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

// ── 成员 ──

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

function handleEvent(e: RealtimeEvent) {
  const meId = state.meId;
  switch (e.type) {
    case "message.new": {
      const convId = e.conversationId as string;
      const msg = e.message as MessageDTO;
      const conv = state.convs.get(convId);
      if (conv) {
        putConv(summarize(conv, msg, meId));
      } else {
        void fetchConversation(convId);
      }
      const ms = state.messages.get(convId);
      if (ms) {
        const lastSeq = ms.items.length ? ms.items[ms.items.length - 1].seq : 0;
        insertMessage(convId, msg);
        if (msg.seq > lastSeq + 1) void syncAfter(convId, lastSeq);
      }
      emit();
      break;
    }
    case "message.updated": {
      const convId = e.conversationId as string;
      const msg = e.message as MessageDTO;
      const ms = state.messages.get(convId);
      if (ms) {
        putMessages(convId, { items: ms.items.map((m) => (m.id === msg.id ? msg : m)) });
      }
      const conv = state.convs.get(convId);
      if (conv?.lastMessage?.seq === msg.seq) {
        patchConv(convId, {
          lastMessage: { ...conv.lastMessage, text: msg.recalled ? "" : msg.text, recalled: msg.recalled },
        });
      }
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
      const conv = state.convs.get(convId);
      if (conv) patchConv(convId, { lastReadSeq: seq, unread: Math.max(0, conv.lastSeq - seq) });
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
  resetIm();
  state.meId = meId;
  void bootstrap();
}

/** 清空全部会话态（退出登录/切换用户时调用） */
export function resetIm() {
  state.meId = null;
  state.convs.clear();
  state.messages.clear();
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
