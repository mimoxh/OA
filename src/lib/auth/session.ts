import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSessionToken } from "./token";

export async function createSession(userId: string) {
  const token = await signSessionToken({ userId });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
