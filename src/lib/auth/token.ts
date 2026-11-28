import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "oa_session";

/** 浏览器 / 桌面端：固定 7 天，不续期 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
/** 手机 App：30 天无访问才过期（滑动续期） */
export const MOBILE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** 滑动续期的最小间隔：令牌签发超过 1 天后的下一次访问才换发新令牌，避免每个请求都写 Cookie */
export const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24;
/** 手机 App 会话自登录起的绝对上限：即使一直在用，到期也要重新输入密码 */
export const MOBILE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/** web：浏览器与桌面端；mobile：登录时 UA 带 OAMobile/ 标记（客户端类型写进令牌，事后改 UA 不能把网页会话变成可续期会话） */
export type SessionClient = "web" | "mobile";
export type SessionPayload = { userId: string; client?: SessionClient; authTime?: number };
export type VerifiedSession = { userId: string; client: SessionClient; authTime: number | null; iat: number | null; exp: number | null };
export type TokenScope = "collab" | "rt" | "rt-publish";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  return new TextEncoder().encode(secret);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function sessionTtlFor(client: SessionClient | undefined) {
  return client === "mobile" ? MOBILE_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
}

export async function signSessionToken(payload: SessionPayload, ttlSeconds = sessionTtlFor(payload.client), now = nowSeconds()) {
  const claims: Record<string, unknown> = { userId: payload.userId };
  if (payload.client === "mobile") claims.cl = "m";
  claims.at = payload.authTime ?? now;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key());
}

export async function verifySessionToken(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    // 带 scope 的令牌（collab / rt / rt-publish）不能充当会话 Cookie
    if (payload.scope) return null;
    if (typeof payload.userId !== "string") return null;
    return {
      userId: payload.userId,
      client: payload.cl === "m" ? "mobile" : "web",
      authTime: typeof payload.at === "number" ? payload.at : null,
      iat: typeof payload.iat === "number" ? payload.iat : null,
      exp: typeof payload.exp === "number" ? payload.exp : null,
    };
  } catch {
    return null;
  }
}

/**
 * 滑动续期：只对手机 App 会话生效。签发超过 1 天后换发一张新的 30 天令牌，
 * 登录时间（at）沿用原值，新令牌的到期时间不超过登录后 180 天。不需要续期时返回 null。
 */
export async function renewSessionToken(
  session: VerifiedSession,
  now = nowSeconds(),
): Promise<{ token: string; maxAge: number } | null> {
  if (session.client !== "mobile" || session.iat == null || session.authTime == null) return null;
  if (now - session.iat < SESSION_RENEW_AFTER_SECONDS) return null;
  const hardLimit = session.authTime + MOBILE_SESSION_MAX_AGE_SECONDS;
  const ttl = Math.min(MOBILE_SESSION_TTL_SECONDS, hardLimit - now);
  // 已接近绝对上限：不再换发，让现有令牌自然过期
  if (ttl <= SESSION_RENEW_AFTER_SECONDS || (session.exp != null && now + ttl <= session.exp)) return null;
  const token = await signSessionToken({ userId: session.userId, client: "mobile", authTime: session.authTime }, ttl, now);
  return { token, maxAge: ttl };
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // 桌面一体包在局域网内走 HTTP，需设置 SESSION_COOKIE_SECURE=false
    secure: process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "false",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function signScopedToken(scope: TokenScope, userId: string | null, ttlSeconds = SESSION_TTL_SECONDS) {
  return new SignJWT({ userId, scope })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key());
}

export async function verifyScopedToken(
  token: string | undefined | null,
  scope: TokenScope,
): Promise<{ userId: string | null } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.scope !== scope) return null;
    return { userId: typeof payload.userId === "string" ? payload.userId : null };
  } catch {
    return null;
  }
}
