import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, isAppEnabled, type CurrentUser } from "@/lib/auth/dal";
import { hasPermission } from "@/lib/permissions";
import { DatabaseError } from "./server";

export type GuardResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse };

export async function guardDatabaseApi(permission: "docs:view" | "docs:edit"): Promise<GuardResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  if (!(await isAppEnabled("docs"))) {
    return { ok: false, response: NextResponse.json({ error: "「文档」应用已停用" }, { status: 403 }) };
  }
  if (!hasPermission(user.permissions, permission)) {
    return { ok: false, response: NextResponse.json({ error: "没有操作多维表格的权限" }, { status: 403 }) };
  }
  return { ok: true, user };
}

export function handleDatabaseError(err: unknown): NextResponse {
  if (err instanceof DatabaseError) {
    return NextResponse.json(
      {
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details ? { details: err.details } : {}),
      },
      { status: err.status },
    );
  }
  console.error("[database-api]", err);
  return NextResponse.json({ error: "服务器处理失败，请稍后重试" }, { status: 500 });
}

export function jsonNoStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
