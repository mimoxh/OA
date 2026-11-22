import { SignJWT } from "jose";
import type { IceServerConfig, RtcJoinConfig, RtcProviderKind } from "@/lib/im/types";

const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export function isLiveKitConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

export function getDefaultRtcProvider(): RtcProviderKind {
  return isLiveKitConfigured() ? "livekit" : "webrtc";
}

export function getIceServers(): IceServerConfig[] {
  const raw = process.env.ICE_SERVERS ?? process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as IceServerConfig[];
    }
  } catch {
    // 配置格式异常时回退默认 STUN
  }
  return DEFAULT_ICE_SERVERS;
}

/**
 * 生成标准 LiveKit AccessToken（HS256 JWT），零额外依赖，直接复用 jose。
 * 规范参考：https://docs.livekit.io/home/get-started/authentication/
 */
async function signLiveKitToken(opts: {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  userId: string;
  userName: string;
  ttlSeconds?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? 2 * 60 * 60;
  return new SignJWT({
    name: opts.userName,
    video: {
      roomJoin: true,
      room: opts.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(opts.apiKey)
    .setSubject(opts.userId)
    .setNotBefore(now - 5)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(new TextEncoder().encode(opts.apiSecret));
}

export async function getRtcJoinConfig(input: {
  roomName: string;
  userId: string;
  userName: string;
  preferredProvider?: RtcProviderKind;
}): Promise<RtcJoinConfig> {
  const iceServers = getIceServers();
  const useLiveKit =
    (input.preferredProvider ?? getDefaultRtcProvider()) === "livekit" && isLiveKitConfigured();

  if (useLiveKit) {
    const token = await signLiveKitToken({
      apiKey: process.env.LIVEKIT_API_KEY!,
      apiSecret: process.env.LIVEKIT_API_SECRET!,
      roomName: input.roomName,
      userId: input.userId,
      userName: input.userName,
    });
    return {
      provider: "livekit",
      roomName: input.roomName,
      url: process.env.LIVEKIT_URL!,
      token,
      iceServers,
    };
  }

  return {
    provider: "webrtc",
    roomName: input.roomName,
    iceServers,
  };
}
