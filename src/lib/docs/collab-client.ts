import "server-only";
import { signSessionToken } from "@/lib/auth/token";

function collabHttpUrl() {
  return process.env.COLLAB_HTTP_URL ?? `http://127.0.0.1:${process.env.COLLAB_PORT ?? 1234}`;
}

/** 调用协同服务的 HTTP 接口（以当前用户身份） */
export async function callCollab<T = { ok: boolean }>(path: "/restore" | "/broadcast", userId: string, body: Record<string, unknown>): Promise<T> {
  const token = await signSessionToken({ userId }, 120);
  let res: Response;
  try {
    res = await fetch(collabHttpUrl() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    throw new Error("协同服务不可用，请稍后重试");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "协同服务返回错误");
  return data as T;
}

/** 尽力通知在线客户端，失败不影响主流程 */
export async function broadcastToDoc(userId: string, documentId: string, payload: Record<string, unknown>) {
  try {
    await callCollab("/broadcast", userId, { documentId, payload });
  } catch {
    // 协同服务离线时客户端会在重连后刷新
  }
}
