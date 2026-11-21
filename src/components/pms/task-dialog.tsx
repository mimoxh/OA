"use client";

import { useState, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import type { UserOption } from "@/lib/crm/types";
import { createTask, type TaskInput } from "@/app/(app)/pms/actions";

type Form = {
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string;
  startDate: string;
  dueDate: string;
  estimateHours: string;
  milestoneId: string;
};

export function TaskDialog({
  projectId,
  members,
  milestones,
  defaultStatus = "TODO",
  trigger,
}: {
  projectId: string;
  members: UserOption[];
  milestones: { id: string; name: string }[];
  defaultStatus?: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const blank: Form = { title: "", description: "", status: defaultStatus, priority: "MEDIUM", assigneeId: "", startDate: "", dueDate: "", estimateHours: "", milestoneId: "" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(blank);
  const { run, pending } = useAction();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () => {
    const payload: TaskInput = {
      title: form.title,
      description: form.description || null,
      status: form.status as "TODO",
      priority: form.priority as "MEDIUM",
      assigneeId: form.assigneeId || null,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      estimateHours: form.estimateHours || null,
      milestoneId: form.milestoneId || null,
    };
    run(() => createTask(projectId, payload), {
      success: "任务已创建",
      onSuccess: (d) => {
        setOpen(false);
        const next = new URLSearchParams(params.toString());
        next.set("task", d.id);
        router.replace(`${pathname}?${next}`, { scroll: false });
      },
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setForm(blank);
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="lg"
        title="新建任务"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              创建任务
            </Button>
          </>
        }
      >
        <form
          className="grid grid-cols-3 gap-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="标题" required className="col-span-3">
            <Input autoFocus value={form.title} onChange={set("title")} placeholder="要做什么？" />
          </Field>
          <Field label="描述" className="col-span-3">
            <Textarea rows={3} value={form.description} onChange={set("description")} />
          </Field>
          <Field label="状态">
            <Select value={form.status} onChange={set("status")}>
              {Object.entries(TASK_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="优先级">
            <Select value={form.priority} onChange={set("priority")}>
              {Object.entries(TASK_PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="负责人">
            <Select value={form.assigneeId} onChange={set("assigneeId")}>
              <option value="">未指派</option>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="开始日期">
            <Input type="date" value={form.startDate} onChange={set("startDate")} />
          </Field>
          <Field label="截止日期">
            <Input type="date" value={form.dueDate} onChange={set("dueDate")} />
          </Field>
          <Field label="预估工时（小时）">
            <Input type="number" min={0} step="0.5" value={form.estimateHours} onChange={set("estimateHours")} />
          </Field>
          <Field label="里程碑" className="col-span-3">
            <Select value={form.milestoneId} onChange={set("milestoneId")}>
              <option value="">无</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
