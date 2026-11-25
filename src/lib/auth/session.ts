import "server-only";
import { cookies, headers } from "next/headers";
import { isMobileUserAgent } from "@/lib/mobile-ua";
import { SESSION_COOKIE, sessionCookieOptions, sessionTtlFor, signSessionToken, type SessionClient } from "./token";

export async function createSession(userId: string) {
  const client: SessionClient = isMobileUserAgent((await headers()).get("user-agent")) ? "mobile" : "web";
  const ttl = sessionTtlFor(client);
  const token = await signSessionToken({ userId, client }, ttl);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(ttl));
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
