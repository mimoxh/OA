// IM 数据传输类型：可在客户端组件中 import type（不得引入服务端依赖）

export type UserLite = { id: string; name: string; avatarColor: string };

export type MessageKind = "TEXT" | "CARD" | "SYSTEM" | "IMAGE" | "FILE";

export type BizType = "project" | "customer" | "opportunity" | "event";

export type ImageContent = {
  attachmentId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
};

export type FileContent = {
  attachmentId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type ReactionGroup = {
  emoji: string;
  users: UserLite[];
};

export type ConversationDTO = {
  id: string;
  type: "DIRECT" | "GROUP" | "BOT";
  /** 群名 | 对方姓名 | 机器人名称 */
  name: string;
  /** 对方颜色 | 机器人颜色 | 群会话按 id 派生 */
  avatarColor: string;
  botKey: string | null;
  bizType: BizType | null;
  bizId: string | null;
  bizHref: string | null;
  bizLabel: string | null;
  peerId: string | null;
  /** 单聊对端已读位置（用于已读回执） */
  peerLastReadSeq: number | null;
  /** 单聊对端为 Webhook 机器人 */
  peerIsBot: boolean;
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
    type: MessageKind;
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
  type: MessageKind;
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
  editedAt: string | null;
  reactions: ReactionGroup[];
  threadRootId: string | null;
  threadCount: number;
  threadLastAt: string | null;
  threadParticipants: UserLite[];
  createdAt: string;
};

export type MessageSearchHit = {
  id: string;
  conversationId: string;
  seq: number;
  type: MessageKind;
  text: string;
  sender: UserLite | null;
  threadRootId: string | null;
  createdAt: string;
};

export type RefType =
  | "document"
  | "approval"
  | "customer"
  | "opportunity"
  | "sales"
  | "purchase"
  | "project"
  | "transport"
  | "event";

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

export type CallKind = "audio" | "video";
export type CallStatus = "RINGING" | "ACTIVE" | "ENDED";
export type RtcProviderKind = "webrtc" | "livekit";
export const STALE_CALL_MS = 12 * 60 * 60 * 1000;

export type CallDTO = {
  id: string;
  conversationId: string;
  conversationType: ConversationDTO["type"];
  conversationName: string;
  initiator: UserLite;
  kind: CallKind;
  status: CallStatus;
  provider: RtcProviderKind;
  roomName: string;
  startedAt: string;
  endedAt: string | null;
};

export type CallPeerInfo = {
  connectionId: string;
  userId: string;
  name: string;
  avatarColor: string;
  audio: boolean;
  video: boolean;
  screen: boolean;
};

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type RtcJoinConfig =
  | {
      provider: "webrtc";
      roomName: string;
      iceServers: IceServerConfig[];
    }
  | {
      provider: "livekit";
      roomName: string;
      url: string;
      token: string;
      iceServers: IceServerConfig[];
    };
