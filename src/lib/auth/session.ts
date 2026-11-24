import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSessionToken } from "./token";

export async function createSession(userId: string) {
  const token = await signSessionToken({ userId });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    // 桌面一体包在局域网内走 HTTP，需设置 SESSION_COOKIE_SECURE=false
    secure: process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "false",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
