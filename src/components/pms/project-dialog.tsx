"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { useAction } from "@/components/ui/use-action";
import { PROJECT_STATUS } from "@/lib/labels";
import { PROJECT_COLORS, PROJECT_ICONS } from "@/lib/pms/utils";
import type { UserOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { createProject, updateProject } from "@/app/(app)/pms/actions";

export type ProjectFormValue = {
  name: string;
  description: string;
  icon: string;
  color: string;
  status: string;
  ownerId: string;
  customerId: string;
  startDate: string;
  endDate: string;
  budget: string;
};

export function ProjectDialog({
  users,
  customers,
  projectId,
  initial,
  currentUserId,
  trigger,
}: {
  users: UserOption[];
  customers: { id: string; name: string }[];
  projectId?: string;
  initial?: ProjectFormValue;
  currentUserId: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const blank: ProjectFormValue = {
    name: "",
    description: "",
    icon: "🚀",
    color: "#2383e2",
    status: "PLANNING",
    ownerId: currentUserId,
    customerId: "",
    startDate: "",
    endDate: "",
    budget: "",
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProjectFormValue>(blank);
  const [members, setMembers] = useState<string[]>([]);
  const [createDoc, setCreateDoc] = useState(true);
  const { run, pending } = useAction();
  const set = (k: keyof ProjectFormValue) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    const payload = {
      ...form,
      status: form.status as "PLANNING",
      customerId: form.customerId || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      budget: form.budget || 0,
    };
    if (projectId) {
      run(() => updateProject(projectId, payload), { success: "项目已更新", onSuccess: () => setOpen(false) });
    } else {
      run(() => createProject({ ...payload, memberIds: members, createDoc }), {
        success: "项目已创建",
        onSuccess: (d) => {
          setOpen(false);
          router.push(`/pms/projects/${d.id}`);
        },
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setForm(initial ?? blank);
          setMembers([]);
          setCreateDoc(true);
        }
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="lg"
        title={projectId ? "编辑项目" : "新建项目"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              {projectId ? "保存" : "创建项目"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 pb-2">
          <Field label="图标与颜色" className="col-span-2">
            <div className="flex flex-wrap items-center gap-1">
              {PROJECT_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, icon: i }))}
                  className={cn("flex size-8 items-center justify-center rounded-md text-lg hover:bg-hover", form.icon === i && "bg-active ring-1 ring-line-strong")}
                >
                  {i}
                </button>
              ))}
              <span className="mx-2 h-5 w-px bg-line" />
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="flex size-6 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: c }}
                >
                  {form.color === c && <Check className="size-3.5" />}
                </button>
              ))}
            </div>
          </Field>
          <Field label="项目名称" required className="col-span-2">
            <Input autoFocus value={form.name} onChange={set("name")} placeholder="例如：协作平台 2.0 开发" />
          </Field>
          <Field label="项目描述" className="col-span-2">
            <Textarea rows={2} value={form.description} onChange={set("description")} />
          </Field>
          <Field label="负责人" required>
            <Select value={form.ownerId} onChange={set("ownerId")}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="状态">
            <Select value={form.status} onChange={set("status")}>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="开始日期">
            <Input type="date" value={form.startDate} onChange={set("startDate")} />
          </Field>
          <Field label="结束日期">
            <Input type="date" value={form.endDate} onChange={set("endDate")} />
          </Field>
          <Field label="关联客户">
            <Select value={form.customerId} onChange={set("customerId")}>
              <option value="">无（内部项目）</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="预算（元）">
            <Input type="number" min={0} value={form.budget} onChange={set("budget")} />
          </Field>
          {!projectId && (
            <>
              <Field label="项目成员" className="col-span-2" hint="负责人会自动加入项目">
                <div className="flex flex-wrap gap-1.5">
                  {users
                    .filter((u) => u.id !== form.ownerId)
                    .map((u) => {
                      const on = members.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setMembers((m) => (on ? m.filter((x) => x !== u.id) : [...m, u.id]))}
                          className={cn(
                            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[13px] transition-colors",
                            on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover",
                          )}
                        >
                          <Avatar name={u.name} color={u.avatarColor} size={18} />
                          {u.name}
                          {on && <Check className="size-3" />}
                        </button>
                      );
                    })}
                </div>
              </Field>
              <Checkbox
                className="col-span-2"
                checked={createDoc}
                onChange={(e) => setCreateDoc(e.target.checked)}
                label="同时创建项目文档空间（私有空间，成员与项目成员同步）"
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
