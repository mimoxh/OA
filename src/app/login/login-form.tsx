"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { isMobileApp, setMobileSessionUser } from "@/lib/mobile-bridge";
import { login } from "./actions";

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  // 能看到登录页说明当前没有有效会话（会话过期、在别处退出）：App 的后台推送随之停止并撤销旧账号的提醒
  useEffect(() => {
    if (isMobileApp()) void setMobileSessionUser(null);
  }, []);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-white p-5 shadow-card">
      <input type="hidden" name="next" value={next} />
      <Field label="邮箱">
        <Input name="email" type="email" autoComplete="email" defaultValue={state?.email ?? (demo ? "admin@demo.com" : "")} required />
      </Field>
      <Field label="密码">
        <Input name="password" type="password" autoComplete="current-password" defaultValue={demo ? "123456" : undefined} required />
      </Field>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" variant="primary" size="md" loading={pending} className="w-full">
        登录
      </Button>
    </form>
  );
}
