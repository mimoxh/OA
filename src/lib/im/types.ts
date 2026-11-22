// IM 数据传输类型：可在客户端组件中 import type（不得引入服务端依赖）

export type UserLite = { id: string; name: string; avatarColor: string };

export type ConversationDTO = {
  id: string;
  type: "DIRECT" | "GROUP" | "BOT";
  /** 群名 | 对方姓名 | 机器人名称 */
  name: string;
  /** 对方颜色 | 机器人颜色 | 群会话按 id 派生 */
  avatarColor: string;
  botKey: string | null;
  peerId: string | null;
  memberCount: number;
  role: "OWNER" | "ADMIN" | "MEMBER";
  lastSeq: number;
  lastReadSeq: number;
  /** unread = lastSeq - lastReadSeq（>=0） */
  unread: number;
  pinned: boolean;
  muted: boolean;
  lastMessage: {
    seq: number;
    type: "TEXT" | "CARD" | "SYSTEM";
    text: string;
    senderName: string | null;
    recalled: boolean;
    createdAt: string;
  } | null;
  lastMessageAt: string | null;
  createdAt: string;
};

export type MessageDTO = {
  id: string;
  conversationId: string;
  seq: number;
  type: "TEXT" | "CARD" | "SYSTEM";
  sender: UserLite | null;
  /** 撤回后为 null */
  content: unknown | null;
  /** 撤回后为 "" */
  text: string;
  mentions: string[];
  links: { type: RefType; id: string }[];
  replyTo: { id: string; seq: number; senderName: string | null; text: string; recalled: boolean } | null;
  clientMsgId: string | null;
  recalled: boolean;
  createdAt: string;
};

export type RefType = "document" | "approval" | "customer" | "opportunity" | "sales" | "purchase" | "project" | "transport";

export type Card = {
  template: "approval" | "generic";
  title: string;
  body?: string | null;
  link?: string | null;
  actor?: UserLite | null;
  ref?: { type: RefType; id: string } | null;
  fields?: { label: string; value: string }[];
  status?: { label: string; color: "blue" | "green" | "red" | "gray" | "orange" } | null;
  actions?: { key: "approve" | "reject"; label: string }[];
};

export type RefPreview = { type: RefType; id: string } & (
  | {
      ok: true;
      title: string;
      subtitle?: string | null;
      icon?: string | null;
      href: string;
      status?: Card["status"];
      fields?: { label: string; value: string }[];
    }
  | { ok: false; reason: "forbidden" | "not_found" }
);
