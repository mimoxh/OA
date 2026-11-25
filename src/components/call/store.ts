"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { CallDTO, CallKind, CallPeerInfo, IceServerConfig, RtcJoinConfig } from "@/lib/im/types";
import { focusDesktopWindow } from "@/lib/desktop-bridge";
import { showDesktopNotification } from "@/lib/im/desktop-notify";
import { sendRealtime, setRealtimeParkGuard, subscribeRealtime, type RealtimeEvent } from "@/components/realtime/provider";

export type RemotePeer = CallPeerInfo & {
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
};

export type ActiveCallState = {
  call: CallDTO;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  audio: boolean;
  video: boolean;
  screen: boolean;
  minimized: boolean;
  joining: boolean;
  mediaWarning: string | null;
  peers: RemotePeer[];
};

export type CallStoreSnapshot = {
  incoming: CallDTO | null;
  active: ActiveCallState | null;
  activeByConv: Record<string, { call: CallDTO; peerCount?: number }>;
};

let meId: string | null = null;
let hooksInstalled = false;
let iceServers: IceServerConfig[] = [{ urls: ["stun:stun.l.google.com:19302"] }];
let incomingTimer: ReturnType<typeof setTimeout> | null = null;
let callGeneration = 0;
let joinRequest: symbol | null = null;

const pcs = new Map<string, RTCPeerConnection>();
const makingOffer = new Map<string, boolean>();
const ignoreOffer = new Map<string, boolean>();
const pendingIce = new Map<string, RTCIceCandidateInit[]>();

let snapshot: CallStoreSnapshot = {
  incoming: null,
  active: null,
  activeByConv: {},
};

const subs = new Set<() => void>();
function setSnapshot(patch: Partial<CallStoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of [...subs]) l();
}
function updateActive(updater: (cur: ActiveCallState) => ActiveCallState | null) {
  if (!snapshot.active) return;
  const next = updater(snapshot.active);
  setSnapshot({ active: next });
}

function subscribe(l: () => void) {
  subs.add(l);
  return () => subs.delete(l);
}

function clearIncomingTimer() {
  if (incomingTimer) {
    clearTimeout(incomingTimer);
    incomingTimer = null;
  }
}

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {}
  }
}

function closePeer(userId: string) {
  const pc = pcs.get(userId);
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onnegotiationneeded = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {}
    pcs.delete(userId);
  }
  makingOffer.delete(userId);
  ignoreOffer.delete(userId);
  pendingIce.delete(userId);
}

function closeAllPeers() {
  for (const id of [...pcs.keys()]) closePeer(id);
}

function releaseActiveCall(cur: ActiveCallState) {
  callGeneration++;
  closeAllPeers();
  stopStream(cur.screenStream);
  stopStream(cur.localStream);
}

function isPolite(remoteUserId: string): boolean {
  return (meId ?? "") < remoteUserId;
}

function getOutboundTracks(cur: ActiveCallState): { audioTrack: MediaStreamTrack | null; videoTrack: MediaStreamTrack | null } {
  const audioTrack = cur.localStream?.getAudioTracks()[0] ?? null;
  const videoTrack = cur.screen
    ? (cur.screenStream?.getVideoTracks()[0] ?? null)
    : (cur.localStream?.getVideoTracks()[0] ?? null);
  return { audioTrack, videoTrack };
}

function ensurePeerConnection(peer: CallPeerInfo): RTCPeerConnection | null {
  const cur = snapshot.active;
  if (!cur || cur.joining) return null;

  const previous = cur.peers.find((item) => item.userId === peer.userId);
  if (previous?.connectionId !== peer.connectionId) {
    closePeer(peer.userId);
    updateActive((s) => ({
      ...s,
      peers: [...s.peers.filter((item) => item.userId !== peer.userId), {
        ...peer,
        stream: null,
        connectionState: "new",
      }],
    }));
  } else if (previous.audio !== peer.audio || previous.video !== peer.video || previous.screen !== peer.screen) {
    updateActive((s) => ({
      ...s,
      peers: s.peers.map((item) => item.userId === peer.userId ? { ...item, ...peer } : item),
    }));
  }

  const existing = pcs.get(peer.userId);
  if (existing) return existing;

  const pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
  pcs.set(peer.userId, pc);

  const callId = cur.call.id;
  const conversationId = cur.call.conversationId;

  // 由 ID 较大的一方建立两条收发轨道，接听端在收到 offer 后使用同一组轨道。
  if (!isPolite(peer.userId)) {
    const { audioTrack, videoTrack } = getOutboundTracks(cur);
    pc.addTransceiver(audioTrack ?? "audio", { direction: "sendrecv" });
    pc.addTransceiver(videoTrack ?? "video", { direction: "sendrecv" });
  }

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    sendRealtime({
      type: "call.signal",
      conversationId,
      callId,
      targetUserId: peer.userId,
      data: { kind: "ice", candidate: ev.candidate.toJSON() },
    });
  };

  pc.ontrack = (ev) => {
    updateActive((s) => ({
      ...s,
      peers: s.peers.map((p) => {
        if (p.userId !== peer.userId) return p;
        const tracks = p.stream?.getTracks().filter((track) => track.kind !== ev.track.kind) ?? [];
        return { ...p, stream: new MediaStream([...tracks, ev.track]) };
      }),
    }));
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === "failed") pc.restartIce();
    updateActive((s) => ({
      ...s,
      peers: s.peers.map((p) => (p.userId === peer.userId ? { ...p, connectionState: st } : p)),
    }));
  };

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer.set(peer.userId, true);
      await pc.setLocalDescription();
      if (pc.localDescription) {
        sendRealtime({
          type: "call.signal",
          conversationId,
          callId,
          targetUserId: peer.userId,
          data: { kind: "description", description: pc.localDescription.toJSON() },
        });
      }
    } catch {
      // 协商期间连接被关闭则静默忽略
    } finally {
      if (pcs.get(peer.userId) === pc) makingOffer.set(peer.userId, false);
    }
  };

  return pc;
}

async function handleSignal(peer: CallPeerInfo, callId: string, data: Record<string, unknown>) {
  const cur = snapshot.active;
  if (!cur || cur.call.id !== callId) return;

  const fromUserId = peer.userId;
  const pc = ensurePeerConnection(peer);
  if (!pc) return;

  try {
    if (data.kind === "description" && data.description) {
      const description = data.description as RTCSessionDescriptionInit;
      const polite = isPolite(fromUserId);
      const offerCollision =
        description.type === "offer" && (makingOffer.get(fromUserId) || pc.signalingState !== "stable");
      const ignore = !polite && offerCollision;
      ignoreOffer.set(fromUserId, ignore);
      if (ignore) return;

      await pc.setRemoteDescription(description);
      // 刷入先前缓冲的 ICE 候选
      const queued = pendingIce.get(fromUserId) ?? [];
      pendingIce.delete(fromUserId);
      for (const c of queued) {
        try {
          await pc.addIceCandidate(c);
        } catch {}
      }

      if (description.type === "offer") {
        const active = snapshot.active;
        if (!active || active.call.id !== callId || pcs.get(fromUserId) !== pc) return;
        const { audioTrack, videoTrack } = getOutboundTracks(active);
        await Promise.all([
          replaceOutboundTrack(pc, "audio", audioTrack),
          replaceOutboundTrack(pc, "video", videoTrack),
        ]);
        await pc.setLocalDescription();
        if (pc.localDescription) {
          sendRealtime({
            type: "call.signal",
            conversationId: cur.call.conversationId,
            callId,
            targetUserId: fromUserId,
            data: { kind: "description", description: pc.localDescription.toJSON() },
          });
        }
      }
    } else if (data.kind === "ice" && data.candidate) {
      if (ignoreOffer.get(fromUserId)) return;
      const candidate = data.candidate as RTCIceCandidateInit;
      if (!pc.remoteDescription) {
        const list = pendingIce.get(fromUserId) ?? [];
        list.push(candidate);
        pendingIce.set(fromUserId, list);
      } else {
        await pc.addIceCandidate(candidate);
      }
    }
  } catch {
    // 忽略偶发信令竞态
  }
}

async function acquireLocalMedia(kind: CallKind): Promise<{
  stream: MediaStream | null;
  audio: boolean;
  video: boolean;
  warning: string | null;
}> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { stream: null, audio: false, video: false, warning: "当前环境不支持音视频采集，已进入旁听模式" };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    return {
      stream,
      audio: stream.getAudioTracks().length > 0,
      video: stream.getVideoTracks().length > 0,
      warning: null,
    };
  } catch {
    // 若摄像头不可用但麦克风可用，降级为纯语音
    if (kind === "video") {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return {
          stream: audioOnly,
          audio: audioOnly.getAudioTracks().length > 0,
          video: false,
          warning: "未检测到摄像头权限，已自动切换为语音模式",
        };
      } catch {
        // 两者都不可用，进入旁听模式
      }
    }
    return {
      stream: null,
      audio: false,
      video: false,
      warning: "未获取到麦克风/摄像头权限，已进入旁听模式",
    };
  }
}

async function replaceOutboundTrack(pc: RTCPeerConnection, kind: "audio" | "video", track: MediaStreamTrack | null) {
  const transceiver = pc.getTransceivers().find((item) => item.receiver.track.kind === kind);
  if (!transceiver) return;
  transceiver.direction = "sendrecv";
  await transceiver.sender.replaceTrack(track);
}

async function replaceTrackAcrossPeers(kind: "audio" | "video", track: MediaStreamTrack | null) {
  await Promise.allSettled([...pcs.values()].map((pc) => replaceOutboundTrack(pc, kind, track)));
}

function broadcastMediaState() {
  const cur = snapshot.active;
  if (!cur) return;
  sendRealtime({
    type: "call.media",
    callId: cur.call.id,
    audio: cur.audio,
    video: cur.video,
    screen: cur.screen,
  });
}

function joinSignalingRoom() {
  const cur = snapshot.active;
  if (!cur || cur.joining) return;
  sendRealtime({
    type: "call.join",
    conversationId: cur.call.conversationId,
    callId: cur.call.id,
    audio: cur.audio,
    video: cur.video,
    screen: cur.screen,
  });
}

async function joinCallInternal(call: CallDTO, desiredKind?: CallKind) {
  const kind = desiredKind ?? call.kind;
  const generation = ++callGeneration;
  clearIncomingTimer();
  setSnapshot({
    incoming: null,
    active: {
      call,
      localStream: null,
      screenStream: null,
      audio: false,
      video: false,
      screen: false,
      minimized: false,
      joining: true,
      mediaWarning: null,
      peers: [],
    },
  });

  // 先确认通话仍然有效，再申请设备权限。
  try {
    const res = await fetch(`/api/im/calls/${call.id}/token?provider=webrtc`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 409 ? "通话已结束" : "无法加入通话");
    const data = (await res.json()) as { rtc: RtcJoinConfig };
    if (generation !== callGeneration) return;
    iceServers = data.rtc.iceServers;
  } catch (err) {
    if (generation === callGeneration && snapshot.active) {
      releaseActiveCall(snapshot.active);
      setSnapshot({ active: null });
      void refreshActiveCalls();
      toast.error(err instanceof Error ? err.message : "无法加入通话");
    }
    return;
  }

  const media = await acquireLocalMedia(kind);
  if (generation !== callGeneration) {
    stopStream(media.stream);
    return;
  }

  updateActive((s) => ({
    ...s,
    localStream: media.stream,
    audio: media.audio,
    video: media.video,
    joining: false,
    mediaWarning: media.warning,
  }));

  if (media.warning) toast.info(media.warning);

  joinSignalingRoom();
}

// ── 公开动作 ──

async function postCall(path: string, body: object, errorMessage: string): Promise<CallDTO | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { call?: CallDTO; error?: string };
    if (res.ok && data.call) return data.call;
    toast.error(data.error ?? errorMessage);
  } catch {
    toast.error(errorMessage);
  }
  return null;
}

export async function startOrJoinConversationCall(conversationId: string, kind: CallKind = "video") {
  if (snapshot.active) {
    if (snapshot.active.call.conversationId === conversationId) {
      setCallMinimized(false);
      return;
    }
    toast.error("你正在另一场通话中，请先挂断后再发起新通话");
    return;
  }
  if (joinRequest) return;
  if (typeof RTCPeerConnection === "undefined") {
    toast.error("当前浏览器不支持音视频通话");
    return;
  }
  const request = (joinRequest = Symbol());
  try {
    const call = await postCall("/api/im/calls", { conversationId, kind }, "发起通话失败");
    if (!call || joinRequest !== request) return;
    setSnapshot({
      activeByConv: {
        ...snapshot.activeByConv,
        [call.conversationId]: { call, peerCount: snapshot.activeByConv[call.conversationId]?.peerCount },
      },
    });
    await joinCallInternal(call, kind);
  } finally {
    if (joinRequest === request) joinRequest = null;
  }
}

export async function acceptIncomingCall(kind?: CallKind) {
  const inc = snapshot.incoming;
  if (!inc || snapshot.active || joinRequest) return;
  if (typeof RTCPeerConnection === "undefined") {
    toast.error("当前浏览器不支持音视频通话");
    return;
  }
  const request = (joinRequest = Symbol());
  clearIncomingTimer();
  try {
    const call = await postCall(`/api/im/calls/${inc.id}/action`, { action: "accept" }, "接听失败");
    if (joinRequest !== request) return;
    if (snapshot.incoming?.id === inc.id) setSnapshot({ incoming: null });
    if (call?.status === "ENDED") toast.error("通话已结束");
    else if (call) await joinCallInternal(call, kind ?? call.kind);
  } finally {
    if (joinRequest === request) joinRequest = null;
  }
}

export async function rejectIncomingCall() {
  const inc = snapshot.incoming;
  if (!inc || joinRequest) return;
  clearIncomingTimer();
  setSnapshot({ incoming: null });
  if (inc.conversationType === "DIRECT") {
    await postCall(`/api/im/calls/${inc.id}/action`, { action: "reject" }, "拒绝通话失败");
  }
}

export async function leaveCurrentCall(endForAll = false) {
  const cur = snapshot.active;
  if (!cur) return;
  const call = cur.call;
  const peerCount = snapshot.activeByConv[call.conversationId]?.peerCount;
  const shouldEndServer = endForAll || call.conversationType === "DIRECT" || peerCount === 1;

  sendRealtime({ type: "call.leave", callId: call.id });
  releaseActiveCall(cur);
  joinRequest = null;
  setSnapshot({ active: null });

  if (shouldEndServer) {
    await postCall(`/api/im/calls/${call.id}/action`, { action: "end" }, "结束通话失败");
  }
}

export function setCallMinimized(minimized: boolean) {
  updateActive((s) => ({ ...s, minimized }));
}

export async function toggleMic() {
  const cur = snapshot.active;
  if (!cur || cur.joining) return;
  const existing = cur.localStream?.getAudioTracks()[0];
  if (existing) {
    const next = !cur.audio;
    existing.enabled = next;
    updateActive((s) => ({ ...s, audio: next }));
    broadcastMediaState();
    return;
  }
  // 旁听模式尝试重新请求麦克风
  const generation = callGeneration;
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const track = audioStream.getAudioTracks()[0];
    const active = snapshot.active;
    if (!track || generation !== callGeneration || !active || active.localStream?.getAudioTracks().length) {
      stopStream(audioStream);
      return;
    }
    const stream = new MediaStream([...(active.localStream?.getTracks() ?? []), track]);
    updateActive((s) => ({ ...s, localStream: stream, audio: true, mediaWarning: null }));
    await replaceTrackAcrossPeers("audio", track);
    if (generation !== callGeneration) return;
    broadcastMediaState();
  } catch {
    toast.error("无法访问麦克风，请检查浏览器权限");
  }
}

export async function toggleCamera() {
  const cur = snapshot.active;
  if (!cur || cur.joining) return;
  const existing = cur.localStream?.getVideoTracks()[0];
  if (existing) {
    const next = !cur.video;
    existing.enabled = next;
    updateActive((s) => ({ ...s, video: next }));
    broadcastMediaState();
    return;
  }
  const generation = callGeneration;
  try {
    const camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const track = camStream.getVideoTracks()[0];
    const active = snapshot.active;
    if (!track || generation !== callGeneration || !active || active.localStream?.getVideoTracks().length) {
      stopStream(camStream);
      return;
    }
    const stream = new MediaStream([...(active.localStream?.getTracks() ?? []), track]);
    updateActive((s) => ({ ...s, localStream: stream, video: true, mediaWarning: null }));
    if (!active.screen) await replaceTrackAcrossPeers("video", track);
    if (generation !== callGeneration) return;
    broadcastMediaState();
  } catch {
    toast.error("无法访问摄像头，请检查浏览器权限");
  }
}

export async function toggleScreenShare() {
  const cur = snapshot.active;
  if (!cur || cur.joining) return;
  const generation = callGeneration;

  if (cur.screen) {
    stopStream(cur.screenStream);
    const camTrack = cur.localStream?.getVideoTracks()[0] ?? null;
    updateActive((s) => ({ ...s, screenStream: null, screen: false }));
    await replaceTrackAcrossPeers("video", camTrack);
    if (generation !== callGeneration) return;
    broadcastMediaState();
    return;
  }

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    toast.error("当前浏览器不支持屏幕共享");
    return;
  }
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack || generation !== callGeneration || !snapshot.active || snapshot.active.screen) {
      stopStream(displayStream);
      return;
    }
    screenTrack.onended = () => {
      if (snapshot.active?.screenStream === displayStream) void toggleScreenShare();
    };
    updateActive((s) => ({ ...s, screenStream: displayStream, screen: true }));
    await replaceTrackAcrossPeers("video", screenTrack);
    if (generation !== callGeneration) return;
    broadcastMediaState();
  } catch {
    // 用户取消共享弹窗
  }
}

export async function refreshActiveCalls() {
  const userId = meId;
  if (!userId) return;
  try {
    const res = await fetch("/api/im/calls/active", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { calls?: CallDTO[] };
    if (meId !== userId) return;
    const next: Record<string, { call: CallDTO; peerCount?: number }> = {};
    for (const c of data.calls ?? []) {
      next[c.conversationId] = {
        call: c,
        peerCount: snapshot.activeByConv[c.conversationId]?.call.id === c.id
          ? snapshot.activeByConv[c.conversationId].peerCount
          : undefined,
      };
    }
    setSnapshot({ activeByConv: next });
  } catch {}
}

// ── 实时事件处理 ──

function handleRealtimeEvent(e: RealtimeEvent) {
  switch (e.type) {
    case "call.invite": {
      const call = e.call as CallDTO;
      if (!call || call.initiator.id === meId) return;
      setSnapshot({
        activeByConv: {
          ...snapshot.activeByConv,
          [call.conversationId]: { call, peerCount: 1 },
        },
      });
      if (snapshot.active) {
        toast.info(`${call.initiator.name} 发起了${call.kind === "audio" ? "语音" : "视频"}通话`);
        return;
      }
      clearIncomingTimer();
      setSnapshot({ incoming: call });
      focusDesktopWindow();
      showDesktopNotification({
        title: `${call.initiator.name} 邀请你加入${call.kind === "audio" ? "语音" : "视频"}${call.conversationType === "GROUP" ? "会议" : "通话"}`,
        body: call.conversationName,
        url: `/messages/${call.conversationId}`,
        tag: `call-${call.id}`,
      });
      incomingTimer = setTimeout(() => {
        if (snapshot.incoming?.id === call.id) setSnapshot({ incoming: null });
      }, 45_000);
      return;
    }
    case "call.updated": {
      const call = e.call as CallDTO;
      if (!call) return;
      const nextByConv = { ...snapshot.activeByConv };
      if (call.status === "ENDED") {
        delete nextByConv[call.conversationId];
      } else {
        const existing = nextByConv[call.conversationId];
        nextByConv[call.conversationId] = {
          call: existing?.call.id === call.id ? { ...call, conversationName: existing.call.conversationName } : call,
          peerCount: existing?.call.id === call.id ? existing.peerCount : undefined,
        };
      }
      setSnapshot({ activeByConv: nextByConv });
      if (snapshot.active?.call.id === call.id) {
        updateActive((s) => ({ ...s, call: { ...call, conversationName: s.call.conversationName } }));
      }
      return;
    }
    case "call.ended": {
      const callId = e.callId as string;
      const conversationId = e.conversationId as string;
      const reason = e.reason as string | undefined;
      const nextByConv = { ...snapshot.activeByConv };
      if (nextByConv[conversationId]?.call.id === callId) delete nextByConv[conversationId];
      const patch: Partial<CallStoreSnapshot> = { activeByConv: nextByConv };
      if (snapshot.incoming?.id === callId) {
        clearIncomingTimer();
        patch.incoming = null;
      }
      if (snapshot.active?.call.id === callId) {
        releaseActiveCall(snapshot.active);
        patch.active = null;
        toast.info(reason === "reject" ? "对方已拒绝通话" : "通话已结束");
      }
      setSnapshot(patch);
      return;
    }
    case "call.peers": {
      const callId = e.callId as string;
      const peers = (e.peers as CallPeerInfo[]) ?? [];
      const active = snapshot.active;
      if (active?.call.id !== callId) return;
      const { conversationId } = active.call;
      const peerIds = new Set(peers.map((peer) => peer.userId));
      for (const peer of active.peers) {
        if (!peerIds.has(peer.userId)) closePeer(peer.userId);
      }
      updateActive((s) => ({ ...s, peers: s.peers.filter((peer) => peerIds.has(peer.userId)) }));
      setSnapshot({
        activeByConv: {
          ...snapshot.activeByConv,
          [conversationId]: { call: active.call, peerCount: peers.length + 1 },
        },
      });
      for (const peer of peers) {
        ensurePeerConnection(peer);
      }
      return;
    }
    case "call.join-rejected": {
      const active = snapshot.active;
      if (!active || active.call.id !== e.callId) return;
      releaseActiveCall(active);
      setSnapshot({ active: null });
      void refreshActiveCalls();
      toast.error("通话已结束或无法加入");
      return;
    }
    case "call.peer-joined": {
      const callId = e.callId as string;
      const conversationId = e.conversationId as string;
      const peer = e.peer as CallPeerInfo;
      const peerCount = typeof e.peerCount === "number" ? e.peerCount : undefined;
      if (snapshot.activeByConv[conversationId]?.call.id === callId) {
        setSnapshot({
          activeByConv: {
            ...snapshot.activeByConv,
            [conversationId]: { ...snapshot.activeByConv[conversationId], peerCount },
          },
        });
      }
      if (snapshot.active?.call.id === callId && peer && peer.userId !== meId) {
        ensurePeerConnection(peer);
      }
      return;
    }
    case "call.peer-left": {
      const callId = e.callId as string;
      const conversationId = e.conversationId as string;
      const leftUserId = e.userId as string;
      const peerCount = typeof e.peerCount === "number" ? e.peerCount : undefined;
      if (snapshot.activeByConv[conversationId]?.call.id === callId) {
        setSnapshot({
          activeByConv: {
            ...snapshot.activeByConv,
            [conversationId]: { ...snapshot.activeByConv[conversationId], peerCount },
          },
        });
      }
      const active = snapshot.active;
      if (
        active?.call.id === callId &&
        active.peers.some((peer) => peer.userId === leftUserId && peer.connectionId === e.connectionId)
      ) {
        closePeer(leftUserId);
        updateActive((s) => ({
          ...s,
          peers: s.peers.filter((p) => p.userId !== leftUserId),
        }));
      }
      return;
    }
    case "call.peer-media": {
      const callId = e.callId as string;
      const userId = e.userId as string;
      if (snapshot.active?.call.id !== callId) return;
      updateActive((s) => ({
        ...s,
        peers: s.peers.map((p) =>
          p.userId === userId && p.connectionId === e.connectionId
            ? {
                ...p,
                audio: typeof e.audio === "boolean" ? e.audio : p.audio,
                video: typeof e.video === "boolean" ? e.video : p.video,
                screen: typeof e.screen === "boolean" ? e.screen : p.screen,
              }
            : p,
        ),
      }));
      return;
    }
    case "call.signal": {
      const callId = e.callId as string;
      const peer = e.peer as CallPeerInfo | undefined;
      const data = e.data as Record<string, unknown>;
      if (callId && peer && data) {
        void handleSignal(peer, callId, data);
      }
      return;
    }
    case "reconnected": {
      void refreshActiveCalls();
      closeAllPeers();
      updateActive((cur) => ({ ...cur, peers: [] }));
      joinSignalingRoom();
      return;
    }
    case "connected": {
      joinSignalingRoom();
      return;
    }
  }
}

export function initCallStore(userId: string) {
  if (!hooksInstalled) {
    hooksInstalled = true;
    subscribeRealtime(handleRealtimeEvent);
    // 通话信令走页面实时连接：通话中或有来电时 App 退到后台也不断开
    setRealtimeParkGuard(() => !!snapshot.active || !!snapshot.incoming);
    window.addEventListener("beforeunload", () => {
      if (snapshot.active) {
        sendRealtime({ type: "call.leave", callId: snapshot.active.call.id });
      }
    });
  }
  if (meId === userId) return;
  resetCallStore();
  meId = userId;
  void refreshActiveCalls();
}

export function resetCallStore() {
  clearIncomingTimer();
  joinRequest = null;
  if (snapshot.active) {
    sendRealtime({ type: "call.leave", callId: snapshot.active.call.id });
    releaseActiveCall(snapshot.active);
  }
  meId = null;
  setSnapshot({ incoming: null, active: null, activeByConv: {} });
}

export function useCallStore(): CallStoreSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function useConversationActiveCall(conversationId: string): { call: CallDTO; peerCount?: number } | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.activeByConv[conversationId] ?? null,
    () => null,
  );
}
