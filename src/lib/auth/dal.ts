import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hasPermission, parsePermissions, type ModuleKey, type Permission } from "@/lib/permissions";
import { moduleOfPermission } from "@/lib/apps";
import { getEnabledAppKeys } from "@/lib/apps-store";
import { parseRailPins } from "@/lib/nav";
import { SESSION_COOKIE, verifySessionToken } from "./token";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  title: string | null;
  roleKey: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string | null;
  permissions: string[];
  railPins: string[];
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { role: true, department: true },
  });
  if (!user || !user.active || user.isBot) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    title: user.title,
    roleKey: user.role.key,
    roleName: user.role.name,
    departmentId: user.departmentId,
    departmentName: user.department?.name ?? null,
    permissions: parsePermissions(user.role.permissions),
    railPins: parseRailPins(user.railPins),
  };
});

/** 当前启用的应用集合（同一请求内缓存） */
export const getEnabledApps = cache(async (): Promise<Set<ModuleKey>> => getEnabledAppKeys());

export async function isAppEnabled(key: ModuleKey): Promise<boolean> {
  return (await getEnabledApps()).has(key);
}

/** 页面 / 布局中使用：未登录跳转登录页 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 页面 / 布局中使用：应用停用跳转提示页，无权限跳转到无权限页 */
export async function requirePermission(p: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  const app = moduleOfPermission(p);
  if (app && !(await isAppEnabled(app))) redirect(`/app-disabled?app=${app}`);
  if (!hasPermission(user.permissions, p)) redirect(`/forbidden?p=${encodeURIComponent(p)}`);
  return user;
}

export function can(user: Pick<CurrentUser, "permissions">, p: Permission) {
  return hasPermission(user.permissions, p);
}
