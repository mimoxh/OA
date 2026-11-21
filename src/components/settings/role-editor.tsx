"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { MODULES } from "@/lib/permissions";
import { UserChip } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/utils";
import { createRole, deleteRole, updateRole } from "@/app/(app)/settings/actions";

export type RoleDetail = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
  permissions: string[];
  users: { id: string; name: string; avatarColor: string; title: string | null; active: boolean }[];
};

function PermissionMatrix({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const isAdmin = value.includes("admin");
  const has = (p: string) => isAdmin || value.includes(p);
  const toggle = (module: string, kind: "view" | "edit", on: boolean) => {
    const set = new Set(value);
    const view = `${module}:view`;
    const edit = `${module}:edit`;
    if (kind === "edit") {
      if (on) {
        set.add(edit);
        set.delete(view);
      } else {
        set.delete(edit);
        set.add(view);
      }
    } else if (on) set.add(view);
    else {
      set.delete(view);
      set.delete(edit);
    }
    onChange([...set]);
  };
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line", disabled && "opacity-70")}>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 border-b border-line px-4 py-3",
          isAdmin ? "bg-tag-purple/40" : "bg-sidebar",
          disabled && "cursor-not-allowed",
        )}
      >
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={isAdmin}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? ["admin"] : [])}
        />
        <span>
          <span className="block text-sm font-medium text-ink">系统管理员</span>
          <span className="block text-xs text-ink-2">拥有全部模块的查看与编辑权限，并可管理成员、部门和角色</span>
        </span>
      </label>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-2">
            <th className="px-4 py-2 font-normal">模块</th>
            <th className="w-24 py-2 text-center font-normal">查看</th>
            <th className="w-24 py-2 text-center font-normal">编辑</th>
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m.key} className="border-b border-line last:border-0">
              <td className="px-4 py-2">
                <div className="font-medium text-ink">{m.name}</div>
                <div className="text-xs text-ink-3">{m.description}</div>
              </td>
              {(["view", "edit"] as const).map((k) => {
                const p = `${m.key}:${k}`;
                const checked = k === "view" ? has(p) || has(`${m.key}:edit`) : has(p);
                return (
                  <td key={k} className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${m.name} ${k === "view" ? "查看" : "编辑"}`}
                      className="size-4 accent-accent"
                      checked={checked}
                      disabled={disabled || isAdmin}
                      onChange={(e) => toggle(m.key, k, e.target.checked)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-line bg-sidebar px-4 py-2 text-xs text-ink-3">编辑权限包含查看权限；个人资料与收件箱对所有成员开放。</div>
    </div>
  );
}

export function RoleEditor({ role }: { role: RoleDetail }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [perms, setPerms] = useState(role.permissions);
  const locked = role.key === "admin";
  const dirty = name !== role.name || description !== (role.description ?? "") || [...perms].sort().join() !== [...role.permissions].sort().join();

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-ink">{role.name}</h2>
            {role.system && (
              <Badge color="purple">
                <Lock className="mr-1 size-3" />
                系统内置
              </Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs text-ink-3">{role.key}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <ConfirmButton
            danger
            title={`删除角色「${role.name}」`}
            description={role.system ? "系统内置角色不能删除。" : role.users.length ? `该角色下还有 ${role.users.length} 名成员，请先调整成员角色。` : "删除后不可恢复。"}
            confirmText="删除"
            disabled={role.system || role.users.length > 0}
            onConfirm={() => run(() => deleteRole(role.id), { success: "角色已删除", refresh: false, onSuccess: () => router.replace("/settings/roles") })}
          >
            <Trash2 className="size-3.5" />
            删除
          </ConfirmButton>
          <Button
            variant="primary"
            loading={pending}
            disabled={!dirty}
            onClick={() => run(() => updateRole({ id: role.id, name, description, permissions: perms }), { success: "角色权限已保存，成员刷新页面后生效" })}
          >
            保存
          </Button>
        </div>
      </div>
      <div className="mt-5 grid max-w-xl grid-cols-2 gap-3">
        <Field label="角色名称" required>
          <Input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="描述">
          <Input value={description} maxLength={100} onChange={(e) => setDescription(e.target.value)} placeholder="可选" />
        </Field>
      </div>
      <h3 className="mb-2 mt-6 text-[13px] font-semibold text-ink">权限</h3>
      <PermissionMatrix value={perms} onChange={setPerms} disabled={locked} />
      {locked && <p className="mt-2 text-xs text-ink-3">系统管理员角色固定拥有全部权限。</p>}
      <h3 className="mb-2 mt-8 text-[13px] font-semibold text-ink">成员 {role.users.length}</h3>
      {role.users.length === 0 ? (
        <p className="text-[13px] text-ink-3">暂无成员使用该角色，可在「成员」页面为成员分配角色。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {role.users.map((u) => (
            <Link
              key={u.id}
              href={`/settings/members?user=${u.id}`}
              className={cn("rounded-full border border-line px-2 py-1 text-[13px] hover:bg-hover", !u.active && "opacity-50")}
            >
              <UserChip name={u.name} color={u.avatarColor} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewRoleButton({ roles }: { roles: { id: string; name: string; permissions: string[] }[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: "", name: "", description: "", copyFrom: "" });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm({ key: "", name: "", description: "", copyFrom: "" });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="size-3.5" />
          新建角色
        </Button>
      </DialogTrigger>
      <DialogContent
        size="sm"
        title="新建角色"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    createRole({
                      key: form.key,
                      name: form.name,
                      description: form.description,
                      permissions: roles.find((r) => r.id === form.copyFrom)?.permissions ?? ["oa:view", "docs:view"],
                    }),
                  {
                    success: "角色已创建",
                    onSuccess: (d) => {
                      setOpen(false);
                      router.push(`/settings/roles?role=${d.id}`);
                    },
                  },
                )
              }
            >
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2">
          <Field label="角色名称" required>
            <Input autoFocus value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：客服" />
          </Field>
          <Field label="角色标识" required hint="小写字母开头，可包含数字和下划线，用于审批流程中的「指定角色」">
            <Input value={form.key} maxLength={30} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })} className="font-mono" placeholder="service" />
          </Field>
          <Field label="描述">
            <Input value={form.description} maxLength={100} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="复制权限自" hint="不选择时默认仅有文档与 OA 查看权限">
            <Select value={form.copyFrom} onChange={(e) => setForm({ ...form, copyFrom: e.target.value })}>
              <option value="">不复制</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
