"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, Circle, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/page";
import { useAction } from "@/components/ui/use-action";
import { MILESTONE_STATUS } from "@/lib/labels";
import { formatDate, toDateInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createMilestone, deleteMilestone, updateMilestone } from "@/app/(app)/pms/actions";

export type MilestoneRow = {
  id: string;
  name: string;
  description: string | null;
  dueDate: Date | null;
  status: "OPEN" | "DONE";
  total: number;
  done: number;
};

function MilestoneDialog({ projectId, milestone, trigger }: { projectId: string; milestone?: MilestoneRow; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", dueDate: "" });
  const { run, pending } = useAction();
  const submit = () =>
    run(
      () =>
        milestone
          ? updateMilestone(milestone.id, { name: form.name, description: form.description, dueDate: form.dueDate || null })
          : createMilestone(projectId, { name: form.name, description: form.description, dueDate: form.dueDate || null }),
      { success: milestone ? "里程碑已更新" : "里程碑已创建", onSuccess: () => setOpen(false) },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v)
          setForm(
            milestone
              ? { name: milestone.name, description: milestone.description ?? "", dueDate: toDateInput(milestone.dueDate) }
              : { name: "", description: "", dueDate: "" },
          );
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        size="sm"
        title={milestone ? "编辑里程碑" : "新建里程碑"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2">
          <Field label="名称" required>
            <Input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="目标日期">
            <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          </Field>
          <Field label="说明">
            <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Milestones({ projectId, milestones, canManage }: { projectId: string; milestones: MilestoneRow[]; canManage: boolean }) {
  const { run } = useAction();
  const today = new Date().setHours(0, 0, 0, 0);
  const addButton = canManage && (
    <MilestoneDialog
      projectId={projectId}
      trigger={
        <Button size="sm">
          <Plus className="size-3.5" />
          新建里程碑
        </Button>
      }
    />
  );
  if (!milestones.length) return <EmptyState icon="◆" title="还没有里程碑" description="用里程碑标记项目的关键节点，并把任务关联到里程碑追踪进度。" action={addButton} />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-ink-2">
          {milestones.filter((m) => m.status === "DONE").length}/{milestones.length} 个已达成
        </span>
        {addButton}
      </div>
      <ol className="relative space-y-3 border-l border-line pl-6">
        {milestones.map((m) => {
          const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
          const late = m.status === "OPEN" && m.dueDate && new Date(m.dueDate).getTime() < today;
          return (
            <li key={m.id} className="relative">
              <span className={cn("absolute -left-[31px] top-4 size-3 rotate-45 rounded-[2px] ring-4 ring-white", m.status === "DONE" ? "bg-[#448361]" : "bg-[#d9730d]")} />
              <div className="rounded-lg border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[15px] font-semibold", m.status === "DONE" && "text-ink-2")}>{m.name}</span>
                      <StatusBadge map={MILESTONE_STATUS} value={m.status} />
                      {late && <span className="text-xs text-danger">已延期</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-ink-2">
                      <CalendarDays className="size-3" />
                      {m.dueDate ? formatDate(m.dueDate) : "未设定日期"}
                    </div>
                    {m.description && <p className="mt-2 text-sm text-ink-2">{m.description}</p>}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="xs"
                        variant={m.status === "DONE" ? "ghost" : "default"}
                        onClick={() =>
                          run(() => updateMilestone(m.id, { status: m.status === "DONE" ? "OPEN" : "DONE" }), {
                            success: m.status === "DONE" ? "已重新打开" : "里程碑已达成 🎉",
                          })
                        }
                      >
                        {m.status === "DONE" ? <RotateCcw className="size-3" /> : <CheckCircle2 className="size-3" />}
                        {m.status === "DONE" ? "重新打开" : "标记达成"}
                      </Button>
                      <MilestoneDialog
                        projectId={projectId}
                        milestone={m}
                        trigger={
                          <IconButton aria-label="编辑里程碑">
                            <Pencil className="size-3.5" />
                          </IconButton>
                        }
                      />
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton aria-label="更多">
                            <MoreHorizontal className="size-4" />
                          </IconButton>
                        </MenuTrigger>
                        <MenuContent align="end">
                          <MenuItem icon={<Circle />} disabled>
                            关联任务 {m.total} 个
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem danger icon={<Trash2 />} onSelect={() => run(() => deleteMilestone(m.id), { success: "里程碑已删除" })}>
                            删除里程碑
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                    <div className="h-full rounded-full bg-[#448361]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-ink-2">
                    {m.done}/{m.total} 任务 · {pct}%
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
