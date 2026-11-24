"use client";

import { useState } from "react";
import { Plus, Tags, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAction } from "@/components/ui/use-action";
import { asTagColor, TASK_TYPE_COLORS } from "@/lib/pms/utils";
import { createTaskType, deleteTaskType, updateTaskType } from "@/app/(app)/pms/actions";
import type { TaskTypeOption } from "./task-board";

function ColorSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Select aria-label="颜色" className="h-8 w-20 text-xs" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {TASK_TYPE_COLORS.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}

function TypeRow({ type, usage }: { type: TaskTypeOption; usage: number }) {
  const { run, pending } = useAction();
  const [name, setName] = useState(type.name);
  const saveName = () => {
    const v = name.trim();
    if (!v || v === type.name) {
      setName(type.name);
      return;
    }
    run(() => updateTaskType(type.id, { name: v }), { success: "已重命名" }).then((r) => {
      if (!r.ok) setName(type.name);
    });
  };
  return (
    <div className="flex items-center gap-2">
      <Badge color={asTagColor(type.color)} className="w-14 justify-center">
        {type.name}
      </Badge>
      <Input
        aria-label="类型名称"
        className="h-8 flex-1 text-[13px]"
        value={name}
        maxLength={20}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <ColorSelect value={type.color} disabled={pending} onChange={(color) => run(() => updateTaskType(type.id, { color }))} />
      <span className="w-14 shrink-0 text-right text-xs text-ink-3">{usage} 个任务</span>
      <IconButton
        aria-label={`删除类型 ${type.name}`}
        title={usage ? "删除后这些任务变为未分类" : "删除"}
        disabled={pending}
        onClick={() => run(() => deleteTaskType(type.id), { success: `已删除「${type.name}」` })}
      >
        <Trash2 className="size-3.5" />
      </IconButton>
    </div>
  );
}

/** 项目任务类型管理：重命名、改颜色、删除、新增 */
export function TaskTypesDialog({ projectId, types, usage }: { projectId: string; types: TaskTypeOption[]; usage: Record<string, number> }) {
  const { run, pending } = useAction();
  const [draft, setDraft] = useState({ name: "", color: "gray" });
  const add = () => {
    if (!draft.name.trim()) return;
    run(() => createTaskType(projectId, { name: draft.name, color: draft.color }), {
      success: "已添加任务类型",
      onSuccess: () => setDraft({ name: "", color: "gray" }),
    });
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Tags className="size-3.5" />
          任务类型
        </Button>
      </DialogTrigger>
      <DialogContent title="任务类型" description="项目内的任务可以按类型分类和筛选">
        <div className="space-y-2 pb-2">
          {types.length === 0 && <p className="py-2 text-[13px] text-ink-3">还没有任务类型</p>}
          {types.map((t) => (
            <TypeRow key={`${t.id}:${t.name}`} type={t} usage={usage[t.id] ?? 0} />
          ))}
          <form
            className="flex items-center gap-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input
              aria-label="新类型名称"
              className="h-8 flex-1 text-[13px]"
              placeholder="新类型名称，例如：设计"
              maxLength={20}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <ColorSelect value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            <Button type="submit" size="sm" variant="primary" loading={pending} disabled={!draft.name.trim()}>
              <Plus className="size-3.5" />
              添加
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
