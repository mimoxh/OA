import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/dal";
import { hasPermission, type Permission } from "@/lib/permissions";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export class ActionError extends Error {}

/**
 * Server Action 统一包装：校验登录与权限、捕获业务错误并返回给前端提示。
 * 抛出的 Error.message 会原样作为错误提示，请使用中文。
 */
export async function runAction<T>(
  permission: Permission | null,
  fn: (user: CurrentUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "登录已过期，请重新登录" };
    if (permission && !hasPermission(user.permissions, permission)) {
      return { ok: false, error: "没有权限执行该操作" };
    }
    const data = await fn(user);
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e);
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : "操作失败" };
  }
}
