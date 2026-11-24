"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/auth/session";

export type LoginState = { error?: string; email?: string } | undefined;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "") || "/messages";
  if (!email || !password) return { error: "请输入邮箱和密码", email };

  const user = await db.user.findUnique({ where: { email } });
  // 机器人影子账号永不允许登录；与密码错误返回相同提示
  if (!user || user.isBot || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "邮箱或密码错误", email };
  }
  if (!user.active) return { error: "账号已停用，请联系管理员", email };

  await createSession(user.id);
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/messages");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
