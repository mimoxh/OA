"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { setupWorkspace } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupWorkspace, undefined);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-white p-5 shadow-card">
      <Field label="管理员姓名" required>
        <Input name="name" autoComplete="name" defaultValue={state?.name} maxLength={40} required autoFocus />
      </Field>
      <Field label="登录邮箱" required>
        <Input name="email" type="email" autoComplete="email" defaultValue={state?.email} required />
      </Field>
      <Field label="密码" required hint="至少 8 位">
        <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="确认密码" required>
        <Input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" variant="primary" size="md" loading={pending} className="w-full">
        创建并进入
      </Button>
    </form>
  );
}
