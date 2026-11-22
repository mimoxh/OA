"use client";

import { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { UserLite } from "@/lib/im/types";
import { cn } from "@/lib/utils";
import {
  acceptIncomingCall,
  leaveCurrentCall,
  rejectIncomingCall,
  setCallMinimized,
  toggleCamera,
  toggleMic,
  toggleScreenShare,
  useCallStore,
  type ActiveCallState,
} from "./store";

function formatElapsed(startedIso: string, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - new Date(startedIso).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 轻柔合成来电提示音（无需外部音频文件） */
function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let ctx: AudioContext | null = null;
    const chime = () => {
      try {
        if (!ctx) ctx = new AudioCtx();
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.16);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      } catch {
        // 浏览器自动播放策略阻止时静默忽略
      }
    };
    chime();
    const timer = setInterval(chime, 2600);
    return () => {
      clearInterval(timer);
      if (ctx) void ctx.close().catch(() => {});
    };
  }, [active]);
}

function MediaTile({
  name,
  avatarColor,
  stream,
  showVideo,
  audioEnabled,
  isScreen,
  isLocal,
  subtitle,
  featured = false,
}: {
  name: string;
  avatarColor: string;
  stream: MediaStream | null;
  showVideo: boolean;
  audioEnabled: boolean;
  isScreen: boolean;
  isLocal: boolean;
  subtitle?: string;
  featured?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    if (stream) {
      void el.play().catch(() => {});
    }
  }, [stream]);

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#22262f]",
        featured ? "min-h-[360px]" : "min-h-[200px]",
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn(
          "size-full transition-opacity",
          isScreen ? "object-contain bg-black" : "object-cover",
          isLocal && !isScreen && "scale-x-[-1]",
          showVideo && stream ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {(!showVideo || !stream) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Avatar name={name} color={avatarColor} size={featured ? 80 : 64} />
          <div className="text-center">
            <div className="text-sm font-medium text-white">{name}</div>
            {subtitle && <div className="mt-0.5 text-xs text-white/55">{subtitle}</div>}
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs text-white backdrop-blur-sm">
        {audioEnabled ? <Mic className="size-3 text-emerald-400" /> : <MicOff className="size-3 text-rose-400" />}
        <span className="max-w-[140px] truncate">{name}</span>
        {isLocal && <span className="text-white/60">（我）</span>}
        {isScreen && <span className="rounded bg-accent/80 px-1.5 py-px text-[10px]">共享中</span>}
      </div>
    </div>
  );
}

/** 最小化时保持远端音轨持续播放 */
function HiddenRemoteAudio({ active }: { active: ActiveCallState }) {
  return (
    <div className="hidden" aria-hidden="true">
      {active.peers.map((p) => (
        <RemoteAudioElement key={p.userId} stream={p.stream} />
      ))}
    </div>
  );
}

function RemoteAudioElement({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

export function CallOverlay({ me }: { me: UserLite }) {
  const { incoming, active } = useCallStore();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const callId = active?.call.id;

  useRingtone(Boolean(incoming && !active));

  useEffect(() => {
    if (!callId) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [callId]);

  if (!incoming && !active) return null;

  // 1. 来电浮窗
  if (incoming && !active) {
    const isGroup = incoming.conversationType === "GROUP";
    const kindLabel = incoming.kind === "audio" ? "语音" : "视频";
    return (
      <div className="fixed right-5 top-5 z-50 w-[330px] overflow-hidden rounded-2xl border border-white/10 bg-[#1c2028] p-4 text-white shadow-2xl animate-pop-in">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar name={incoming.initiator.name} color={incoming.initiator.avatarColor} size={44} />
            <span className="absolute -bottom-0.5 -right-0.5 size-3 animate-ping rounded-full bg-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{incoming.initiator.name}</div>
            <div className="truncate text-xs text-white/70">
              邀请你加入{kindLabel}
              {isGroup ? `会议 · ${incoming.conversationName}` : "通话"}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void rejectIncomingCall()}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-rose-500/90 px-3.5 text-xs font-medium text-white hover:bg-rose-500"
          >
            <PhoneOff className="size-3.5" />
            {isGroup ? "忽略" : "拒绝"}
          </button>
          {incoming.kind === "video" && (
            <button
              type="button"
              onClick={() => void acceptIncomingCall("audio")}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-medium text-white hover:bg-white/25"
              title="仅语音接听"
            >
              <Phone className="size-3.5" />
              语音
            </button>
          )}
          <button
            type="button"
            onClick={() => void acceptIncomingCall(incoming.kind)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500 px-4 text-xs font-medium text-white hover:bg-emerald-400"
          >
            {incoming.kind === "audio" ? <Phone className="size-3.5" /> : <Video className="size-3.5" />}
            接听
          </button>
        </div>
      </div>
    );
  }

  if (!active) return null;

  const elapsed = formatElapsed(active.call.startedAt, nowMs);
  const participantCount = active.peers.length + 1;
  const localVisualStream = active.screen ? active.screenStream : active.localStream;

  // 2. 最小化浮窗
  if (active.minimized) {
    return (
      <>
        <HiddenRemoteAudio active={active} />
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#1c2028] px-3.5 py-2.5 text-white shadow-2xl">
          <span className="size-2.5 animate-pulse rounded-full bg-emerald-400" />
          <div className="min-w-0 max-w-[180px]">
            <div className="truncate text-xs font-medium">{active.call.conversationName}</div>
            <div className="text-[11px] text-white/65">
              {elapsed} · {participantCount} 人
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleMic()}
            className={cn(
              "rounded-full p-2 transition-colors",
              active.audio ? "bg-white/10 hover:bg-white/20" : "bg-rose-500/85 hover:bg-rose-500",
            )}
            title={active.audio ? "静音" : "取消静音"}
          >
            {active.audio ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setCallMinimized(false)}
            className="rounded-full bg-white/10 p-2 hover:bg-white/20"
            title="展开通话界面"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void leaveCurrentCall(false)}
            className="rounded-full bg-rose-500 p-2 hover:bg-rose-400"
            title="挂断"
          >
            <PhoneOff className="size-3.5" />
          </button>
        </div>
      </>
    );
  }

  // 3. 完整会议视图
  const tiles = [
    {
      key: `local-${me.id}`,
      name: me.name,
      avatarColor: me.avatarColor,
      stream: localVisualStream,
      showVideo: active.screen || active.video,
      audioEnabled: active.audio,
      isScreen: active.screen,
      isLocal: true,
      subtitle: active.joining
        ? "正在连接…"
        : active.peers.length === 0
          ? active.call.status === "RINGING"
            ? "等待对方接听…"
            : "等待其他成员加入…"
          : undefined,
    },
    ...active.peers.map((p) => ({
      key: p.userId,
      name: p.name,
      avatarColor: p.avatarColor,
      stream: p.stream,
      showVideo: p.screen || p.video,
      audioEnabled: p.audio,
      isScreen: p.screen,
      isLocal: false,
      subtitle:
        p.connectionState === "connecting" || p.connectionState === "new"
          ? "正在建立连接…"
          : p.connectionState === "failed"
            ? "连接中断，重连中"
            : undefined,
    })),
  ];

  const screenTile = tiles.find((t) => t.isScreen) ?? null;
  const sideTiles = screenTile ? tiles.filter((t) => t.key !== screenTile.key) : [];
  const renderTile = ({ key, ...tile }: (typeof tiles)[number], featured = false) => (
    <MediaTile key={key} {...tile} featured={featured} />
  );
  const gridCols =
    tiles.length <= 1
      ? "grid-cols-1 max-w-2xl mx-auto w-full"
      : tiles.length === 2
        ? "grid-cols-1 md:grid-cols-2"
        : tiles.length <= 4
          ? "grid-cols-2"
          : "grid-cols-2 lg:grid-cols-3";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#14171f] text-white">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="size-2.5 rounded-full bg-emerald-400" />
          <div className="truncate text-[15px] font-semibold">{active.call.conversationName}</div>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80">{elapsed}</span>
          <span className="inline-flex items-center gap-1 text-xs text-white/65">
            <Users className="size-3.5" />
            {participantCount} 人
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCallMinimized(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs text-white/90 hover:bg-white/20"
        >
          <Minimize2 className="size-3.5" />
          最小化
        </button>
      </header>

      {active.mediaWarning && (
        <div className="bg-amber-500/15 px-4 py-1.5 text-center text-xs text-amber-200">{active.mediaWarning}</div>
      )}

      {/* 视频画面区 */}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {screenTile ? (
          <div className="flex h-full flex-col gap-4 lg:flex-row">
            <div className="flex min-h-0 flex-1 flex-col">
              {renderTile(screenTile, true)}
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-3 lg:w-[280px] lg:grid-cols-1 lg:overflow-y-auto">
              {sideTiles.map((tile) => renderTile(tile))}
            </div>
          </div>
        ) : (
          <div className={cn("grid h-full auto-rows-fr gap-4", gridCols)}>
            {tiles.map((tile) => renderTile(tile))}
          </div>
        )}
      </main>

      {/* 底部控制栏 */}
      <footer className="flex h-20 shrink-0 items-center justify-center gap-3 border-t border-white/10 bg-[#1a1e28]/90 px-4">
        <button
          type="button"
          onClick={() => void toggleMic()}
          className={cn(
            "flex h-11 items-center gap-2 rounded-full px-4 text-xs font-medium transition-colors",
            active.audio ? "bg-white/12 text-white hover:bg-white/20" : "bg-rose-500/90 text-white hover:bg-rose-500",
          )}
        >
          {active.audio ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          <span>{active.audio ? "静音" : "取消静音"}</span>
        </button>

        <button
          type="button"
          onClick={() => void toggleCamera()}
          className={cn(
            "flex h-11 items-center gap-2 rounded-full px-4 text-xs font-medium transition-colors",
            active.video ? "bg-white/12 text-white hover:bg-white/20" : "bg-rose-500/90 text-white hover:bg-rose-500",
          )}
        >
          {active.video ? <Video className="size-4" /> : <VideoOff className="size-4" />}
          <span>{active.video ? "关闭视频" : "开启视频"}</span>
        </button>

        <button
          type="button"
          onClick={() => void toggleScreenShare()}
          className={cn(
            "flex h-11 items-center gap-2 rounded-full px-4 text-xs font-medium transition-colors",
            active.screen ? "bg-accent text-white hover:bg-accent-hover" : "bg-white/12 text-white hover:bg-white/20",
          )}
        >
          {active.screen ? <MonitorOff className="size-4" /> : <MonitorUp className="size-4" />}
          <span>{active.screen ? "停止共享" : "共享屏幕"}</span>
        </button>

        <button
          type="button"
          onClick={() => void leaveCurrentCall(false)}
          className="flex h-11 items-center gap-2 rounded-full bg-rose-500 px-5 text-xs font-medium text-white hover:bg-rose-400"
        >
          <PhoneOff className="size-4" />
          <span>{active.call.conversationType === "GROUP" && active.peers.length > 0 ? "离开会议" : "挂断"}</span>
        </button>

        {active.call.conversationType === "GROUP" && active.peers.length > 0 && active.call.initiator.id === me.id && (
          <button
            type="button"
            onClick={() => void leaveCurrentCall(true)}
            className="flex h-11 items-center gap-1.5 rounded-full border border-rose-400/50 bg-rose-500/20 px-4 text-xs font-medium text-rose-200 hover:bg-rose-500/35"
          >
            全员结束
          </button>
        )}
      </footer>
    </div>
  );
}
