"use client";

import { useState, type ReactNode } from "react";
import { KeyRound, Power, Plus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { ColorPicker } from "@/components/oa/color-picker";
import { PALETTE } from "@/lib/oa/types";
import { formatDateTime } from "@/lib/format";
import { createMember, resetMemberPassword, setMemberActive, updateMember } from "@/app/(app)/settings/actions";
import { deptOptionLabel } from "./dept-utils";

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  title: string | null;
  phone: string | null;
  active: boolean;
  departmentId: string | null;
  departmentName: string | null;
  roleId: string;
  roleName: string;
  createdAt: string;
};

export type DeptOption = { id: string; name: string; depth: number };
export type RoleOption = { id: string; name: string };

type FormState = {
  name: string;
  email: string;
  departmentId: string;
  roleId: string;
  title: string;
  phone: string;
  avatarColor: string;
};

function MemberFields({
  form,
  setForm,
  departments,
  roles,
  children,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  departments: DeptOption[];
  roles: RoleOption[];
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 pb-2">
      <Field label="姓名" required>
        <Input value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="邮箱（登录账号）" required>
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="部门">
        <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
          <option value="">未分配</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {deptOptionLabel(d)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="角色" required>
        <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="职位">
        <Input value={form.title} maxLength={30} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="手机">
        <Input value={form.phone} maxLength={20} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      {children}
      <div className="col-span-2">
        <span className="mb-1 block text-xs font-medium text-ink-2">头像颜色</span>
        <div className="flex items-center gap-3">
          <Avatar name={form.name || "?"} color={form.avatarColor} size={36} />
          <ColorPicker value={form.avatarColor} onChange={(c) => setForm({ ...form, avatarColor: c })} />
        </div>
      </div>
    </div>
  );
}

export function NewMemberButton({ departments, roles, defaultRoleId }: { departments: DeptOption[]; roles: RoleOption[]; defaultRoleId: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const blank: FormState = { name: "", email: "", departmentId: "", roleId: defaultRoleId, title: "", phone: "", avatarColor: PALETTE[0] };
  const [form, setForm] = useState(blank);
  const [password, setPassword] = useState("123456");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm({ ...blank, avatarColor: PALETTE[Math.floor(Math.random() * 10)] });
          setPassword("123456");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="size-3.5" />
          新建成员
        </Button>
      </DialogTrigger>
      <DialogContent
        title="新建成员"
        description="成员使用邮箱和初始密码登录，登录后可在个人资料中修改密码。"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => createMember({ ...form, password }), {
                  success: `已创建成员「${form.name}」`,
                  onSuccess: () => setOpen(false),
                })
              }
            >
              创建
            </Button>
          </>
        }
      >
        <MemberFields form={form} setForm={setForm} departments={departments} roles={roles}>
          <Field label="初始密码" required hint="至少 6 位" className="col-span-2">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
          </Field>
        </MemberFields>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordButton({ member }: { member: MemberRow }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setPassword("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost">
          <KeyRound className="size-3.5" />
          重置密码
        </Button>
      </DialogTrigger>
      <DialogContent
        size="sm"
        title={`重置「${member.name}」的密码`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={password.length < 6}
              onClick={() => run(() => resetMemberPassword({ id: member.id, password }), { success: "密码已重置", onSuccess: () => setOpen(false) })}
            >
              重置
            </Button>
          </>
        }
      >
        <Field label="新密码" hint="至少 6 位，请通过安全渠道告知该成员">
          <Input autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

export function MemberDialog({
  member,
  departments,
  roles,
  meId,
  onClose,
}: {
  member: MemberRow;
  departments: DeptOption[];
  roles: RoleOption[];
  meId: string;
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  const [form, setForm] = useState<FormState>({
    name: member.name,
    email: member.email,
    departmentId: member.departmentId ?? "",
    roleId: member.roleId,
    title: member.title ?? "",
    phone: member.phone ?? "",
    avatarColor: member.avatarColor,
  });
  const self = member.id === meId;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="lg"
        title={
          <span className="flex items-center gap-3">
            <Avatar name={member.name} color={member.avatarColor} size={40} />
            <span>
              <span className="flex items-center gap-2">
                {member.name}
                {!member.active && <Badge color="red">已停用</Badge>}
                {self && <Badge color="blue">我</Badge>}
              </span>
              <span className="block text-xs font-normal text-ink-3">
                {member.email} · 加入于 {formatDateTime(member.createdAt)}
              </span>
            </span>
          </span>
        }
        footer={
          <>
            <div className="mr-auto flex items-center gap-1">
              <ResetPasswordButton member={member} />
              {!self && (
                <ConfirmButton
                  variant="ghost"
                  danger={member.active}
                  title={member.active ? `停用「${member.name}」` : `启用「${member.name}」`}
                  description={member.active ? "停用后该成员将无法登录，历史数据会保留。" : "启用后该成员可以重新登录。"}
                  confirmText={member.active ? "停用" : "启用"}
                  onConfirm={() =>
                    run(() => setMemberActive(member.id, !member.active), { success: member.active ? "已停用" : "已启用", onSuccess: onClose })
                  }
                >
                  <Power className="size-3.5" />
                  {member.active ? "停用账号" : "启用账号"}
                </ConfirmButton>
              )}
            </div>
            <Button onClick={onClose}>取消</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => run(() => updateMember({ id: member.id, ...form }), { success: "成员信息已保存", onSuccess: onClose })}
            >
              保存
            </Button>
          </>
        }
      >
        <MemberFields form={form} setForm={setForm} departments={departments} roles={roles} />
      </DialogContent>
    </Dialog>
  );
}
