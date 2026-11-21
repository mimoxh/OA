import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hasPermission, parsePermissions, type Permission } from "@/lib/permissions";
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
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { role: true, department: true },
  });
  if (!user || !user.active) return null;
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
  };
});

/** 页面 / 布局中使用：未登录跳转登录页 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 页面 / 布局中使用：无权限跳转到无权限页 */
export async function requirePermission(p: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user.permissions, p)) redirect(`/forbidden?p=${encodeURIComponent(p)}`);
  return user;
}

export function can(user: Pick<CurrentUser, "permissions">, p: Permission) {
  return hasPermission(user.permissions, p);
}
