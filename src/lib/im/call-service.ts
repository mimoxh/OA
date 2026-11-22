import { randomBytes } from "node:crypto";
import { db, type DbClient } from "@/lib/db";
import { queueEvent } from "@/lib/realtime/buffer";
import { appendMessage, requireMember } from "./service";
import { STALE_CALL_MS } from "./types";
import type { CallDTO, CallKind, CallStatus } from "./types";

const userLiteSelect = { id: true, name: true, avatarColor: true } as const;
const callDetails = {
  initiator: { select: userLiteSelect },
  conversation: { select: { id: true, type: true, name: true } },
} as const;

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

async function resolveConvDisplayName(
  client: DbClient,
  conv: { id: string; type: string; name: string | null },
  viewerId: string,
): Promise<string> {
  if (conv.type !== "DIRECT") return conv.name ?? "群聊";
  const peer = await client.conversationMember.findFirst({
    where: { conversationId: conv.id, userId: { not: viewerId } },
    select: { user: { select: { name: true } } },
  });
  return peer?.user.name ?? "单聊";
}

function toCallDTO(
  row: {
    id: string;
    conversationId: string;
    kind: string;
    status: string;
    provider: string;
    roomName: string;
    startedAt: Date;
    endedAt: Date | null;
    initiator: { id: string; name: string; avatarColor: string };
    conversation: { id: string; type: string; name: string | null };
  },
  convDisplayName: string,
): CallDTO {
  return {
    id: row.id,
    conversationId: row.conversationId,
    conversationType: row.conversation.type as CallDTO["conversationType"],
    conversationName: convDisplayName,
    initiator: row.initiator,
    kind: row.kind === "audio" ? "audio" : "video",
    status: row.status as CallStatus,
    provider: row.provider === "livekit" ? "livekit" : "webrtc",
    roomName: row.roomName,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

/** 清理超长未关闭的僵尸通话 */
async function expireStaleCalls(client: DbClient, userId: string, conversationId?: string) {
  const cutoff = new Date(Date.now() - STALE_CALL_MS);
  await client.callSession.updateMany({
    where: {
      status: { in: ["RINGING", "ACTIVE"] },
      startedAt: { lt: cutoff },
      conversation: { members: { some: { userId } } },
      ...(conversationId ? { conversationId } : {}),
    },
    data: { status: "ENDED", endedAt: new Date() },
  });
}

async function lockCallConversation(client: DbClient, conversationId: string) {
  // 发起和结束先写入同一会话行，再更新通话与系统消息。
  await client.conversation.update({
    where: { id: conversationId },
    data: { lastSeq: { increment: 0 } },
    select: { id: true },
  });
}

export async function startOrJoinCall(
  client: DbClient,
  input: { userId: string; conversationId: string; kind: CallKind },
): Promise<{ call: CallDTO; joinedExisting: boolean }> {
  await requireMember(client, input.conversationId, input.userId);
  const conv = await client.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, type: true, name: true },
  });
  if (!conv) throw new Error("会话不存在");
  if (conv.type === "BOT") throw new Error("机器人会话不支持音视频通话");

  await lockCallConversation(client, conv.id);
  await expireStaleCalls(client, input.userId, conv.id);

  const existing = await client.callSession.findFirst({
    where: { conversationId: input.conversationId, status: { in: ["RINGING", "ACTIVE"] } },
    orderBy: { startedAt: "desc" },
    include: callDetails,
  });

  const members = await client.conversationMember.findMany({
    where: { conversationId: input.conversationId },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);

  if (existing) {
    let cur = existing;
    if (existing.status === "RINGING" && existing.initiatorId !== input.userId) {
      const { count } = await client.callSession.updateMany({
        where: { id: existing.id, status: "RINGING" },
        data: { status: "ACTIVE" },
      });
      cur = await client.callSession.findUniqueOrThrow({ where: { id: existing.id }, include: callDetails });
      if (count) {
        const dtoForAll = toCallDTO(cur, conv.type === "DIRECT" ? cur.initiator.name : (conv.name ?? "群聊"));
        queueEvent(memberIds, { type: "call.updated", call: dtoForAll });
      }
    }
    const name = await resolveConvDisplayName(client, conv, input.userId);
    return { call: toCallDTO(cur, name), joinedExisting: true };
  }

  const roomName = `call-${randomBytes(8).toString("hex")}`;
  const status: CallStatus = conv.type === "DIRECT" ? "RINGING" : "ACTIVE";
  const created = await client.callSession.create({
    data: {
      conversationId: input.conversationId,
      initiatorId: input.userId,
      kind: input.kind,
      status,
      roomName,
    },
    include: callDetails,
  });

  const kindLabel = input.kind === "audio" ? "语音" : "视频";
  const callLabel = conv.type === "GROUP" ? `${kindLabel}会议` : `${kindLabel}通话`;
  await appendMessage(client, {
    conversationId: input.conversationId,
    senderId: null,
    type: "SYSTEM",
    readBy: input.userId,
    content: { text: `${created.initiator.name} 发起了${callLabel}` },
    text: `${created.initiator.name} 发起了${callLabel}`,
  });

  const otherIds = memberIds.filter((id) => id !== input.userId);
  const inviteDto = toCallDTO(
    created,
    conv.type === "DIRECT" ? created.initiator.name : (conv.name ?? "群聊"),
  );
  if (otherIds.length) {
    queueEvent(otherIds, { type: "call.invite", call: inviteDto });
  }
  queueEvent(memberIds, { type: "call.updated", call: inviteDto });

  const viewerName = await resolveConvDisplayName(client, conv, input.userId);
  return { call: toCallDTO(created, viewerName), joinedExisting: false };
}

export async function actOnCall(
  client: DbClient,
  input: { userId: string; callId: string; action: "accept" | "reject" | "end" },
): Promise<CallDTO> {
  const existing = await client.callSession.findFirst({
    where: { id: input.callId, conversation: { members: { some: { userId: input.userId } } } },
    select: { conversationId: true },
  });
  if (!existing) throw new Error("通话不存在或无权限");
  await lockCallConversation(client, existing.conversationId);
  await expireStaleCalls(client, input.userId, existing.conversationId);
  const row = await client.callSession.findUniqueOrThrow({ where: { id: input.callId }, include: callDetails });

  const members = await client.conversationMember.findMany({
    where: { conversationId: row.conversationId },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);
  const viewerName = await resolveConvDisplayName(client, row.conversation, input.userId);

  if (row.status === "ENDED") {
    return toCallDTO(row, viewerName);
  }

  if (input.action === "accept") {
    if (row.status !== "RINGING" || row.initiatorId === input.userId) return toCallDTO(row, viewerName);
    const { count } = await client.callSession.updateMany({
      where: { id: row.id, status: "RINGING" },
      data: { status: "ACTIVE" },
    });
    const updated = await client.callSession.findUniqueOrThrow({ where: { id: row.id }, include: callDetails });
    if (count) {
      const dto = toCallDTO(
        updated,
        updated.conversation.type === "DIRECT" ? updated.initiator.name : (updated.conversation.name ?? "群聊"),
      );
      queueEvent(memberIds, { type: "call.updated", call: dto });
    }
    return toCallDTO(updated, viewerName);
  }

  if (input.action === "reject" && (row.conversation.type !== "DIRECT" || row.initiatorId === input.userId)) {
    return toCallDTO(row, viewerName);
  }
  const actor = await client.user.findUnique({ where: { id: input.userId }, select: { name: true } });
  const actorName = actor?.name ?? "成员";
  const endedAt = new Date();
  const { count } = await client.callSession.updateMany({
    where: { id: row.id, status: input.action === "reject" ? "RINGING" : { in: ["RINGING", "ACTIVE"] } },
    data: { status: "ENDED", endedAt },
  });
  const updated = await client.callSession.findUniqueOrThrow({ where: { id: row.id }, include: callDetails });
  if (!count) return toCallDTO(updated, viewerName);

  const kindLabel = row.kind === "audio" ? "语音" : "视频";
  const callLabel = row.conversation.type === "GROUP" ? `${kindLabel}会议` : `${kindLabel}通话`;
  let sysText: string;
  if (input.action === "reject") {
    sysText = `${actorName} 拒绝了${callLabel}`;
  } else if (row.status === "RINGING") {
    sysText = `${actorName} 取消了${callLabel}`;
  } else {
    sysText = `${callLabel}已结束 · 时长 ${formatDuration(endedAt.getTime() - row.startedAt.getTime())}`;
  }

  await appendMessage(client, {
    conversationId: row.conversationId,
    senderId: null,
    type: "SYSTEM",
    readBy: input.userId,
    content: { text: sysText },
    text: sysText,
  });

  const dto = toCallDTO(
    updated,
    updated.conversation.type === "DIRECT" ? updated.initiator.name : (updated.conversation.name ?? "群聊"),
  );
  queueEvent(memberIds, {
    type: "call.ended",
    callId: updated.id,
    conversationId: updated.conversationId,
    reason: input.action,
    call: dto,
  });

  return toCallDTO(updated, viewerName);
}

export async function getCallForMember(
  userId: string,
  callId: string,
  client: DbClient = db,
): Promise<CallDTO | null> {
  const row = await client.callSession.findFirst({
    where: { id: callId, conversation: { members: { some: { userId } } } },
    include: callDetails,
  });
  if (!row) return null;
  const name = await resolveConvDisplayName(client, row.conversation, userId);
  if (row.status !== "ENDED" && Date.now() - row.startedAt.getTime() >= STALE_CALL_MS) {
    return toCallDTO({ ...row, status: "ENDED" }, name);
  }
  return toCallDTO(row, name);
}

export async function listActiveCallsForUser(
  userId: string,
  conversationId?: string,
  client: DbClient = db,
): Promise<CallDTO[]> {
  await expireStaleCalls(client, userId, conversationId);
  const rows = await client.callSession.findMany({
    where: {
      status: { in: ["RINGING", "ACTIVE"] },
      ...(conversationId ? { conversationId } : {}),
      conversation: { members: { some: { userId } } },
    },
    orderBy: { startedAt: "desc" },
    include: callDetails,
  });
  const res: CallDTO[] = [];
  for (const r of rows) {
    const name = await resolveConvDisplayName(client, r.conversation, userId);
    res.push(toCallDTO(r, name));
  }
  return res;
}
