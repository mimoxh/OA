import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "oa_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = { userId: string };
export type TokenScope = "collab" | "rt" | "rt-publish";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload, ttlSeconds = SESSION_TTL_SECONDS) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    // 带 scope 的令牌（collab / rt / rt-publish）不能充当会话 Cookie
    if (payload.scope) return null;
    return typeof payload.userId === "string" ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
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
