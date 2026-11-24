"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { ensureWorkspaceDefaults } from "@/lib/setup/defaults";
import { createPersonalSpace } from "@/lib/docs/personal";

export type SetupState = { error?: string; name?: string; email?: string } | undefined;

class AlreadyInitialized extends Error {}

/** 首次启动：在空数据库中创建基础数据与第一个管理员，仅当还没有任何用户时可用 */
export async function setupWorkspace(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const keep = { name, email };

  if (!name || name.length > 40) return { error: "请填写姓名（不超过 40 个字）", ...keep };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "请填写有效的邮箱，它将作为登录账号", ...keep };
  if (password.length < 8) return { error: "密码至少 8 位", ...keep };
  if (password !== confirm) return { error: "两次输入的密码不一致", ...keep };

  const passwordHash = await bcrypt.hash(password, 10);
  let userId: string;
  try {
    userId = await db.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new AlreadyInitialized();
      await ensureWorkspaceDefaults(tx);
      const role = await tx.role.findUniqueOrThrow({ where: { key: "admin" }, select: { id: true } });
      const admin = await tx.user.create({
        data: { email, name, passwordHash, title: "系统管理员", roleId: role.id, avatarColor: "#2383e2" },
      });
      await createPersonalSpace(tx, admin.id);
      return admin.id;
    });
  } catch (e) {
    if (e instanceof AlreadyInitialized) redirect("/login");
    throw e;
  }

  await createSession(userId);
  redirect("/settings/members");
}
