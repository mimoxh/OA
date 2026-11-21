"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { ColorPicker } from "@/components/oa/color-picker";
import { changePassword, updateProfile } from "@/app/(app)/settings/actions";

export function ProfileForm({ initial }: { initial: { name: string; title: string; phone: string; avatarColor: string } }) {
  const { run, pending } = useAction();
  const [form, setForm] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateProfile(form), { success: "个人资料已保存" });
      }}
    >
      <div className="flex items-center gap-4">
        <Avatar name={form.name || "?"} color={form.avatarColor} size={56} />
        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-2">头像颜色</span>
          <ColorPicker value={form.avatarColor} onChange={(c) => setForm({ ...form, avatarColor: c })} />
        </div>
      </div>
      <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="姓名" required>
          <Input value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="职位">
          <Input value={form.title} maxLength={30} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="手机">
          <Input value={form.phone} maxLength={20} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
      </div>
      <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
        保存资料
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const { run, pending } = useAction();
  const [form, setForm] = useState({ oldPassword: "", newPassword: "", confirm: "" });
  const mismatch = !!form.confirm && form.confirm !== form.newPassword;
  return (
    <form
      className="max-w-sm space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (mismatch) return;
        run(() => changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword }), {
          success: "密码已修改，下次登录请使用新密码",
          onSuccess: () => setForm({ oldPassword: "", newPassword: "", confirm: "" }),
        });
      }}
    >
      <Field label="当前密码" required>
        <Input type="password" autoComplete="current-password" value={form.oldPassword} onChange={(e) => setForm({ ...form, oldPassword: e.target.value })} />
      </Field>
      <Field label="新密码" required hint="至少 6 位">
        <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
      </Field>
      <Field label="确认新密码" required>
        <Input
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          className={mismatch ? "border-danger" : undefined}
        />
        {mismatch && <span className="mt-1 block text-xs text-danger">两次输入的密码不一致</span>}
      </Field>
      <Button
        type="submit"
        loading={pending}
        disabled={!form.oldPassword || form.newPassword.length < 6 || form.confirm !== form.newPassword}
      >
        修改密码
      </Button>
    </form>
  );
}
