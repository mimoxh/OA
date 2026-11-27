"use client";

import type { ReactNode } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { asTagColor, dueBucket, TASK_PRIORITY_ORDER, TASK_STATUS_ORDER } from "@/lib/pms/utils";
import type { UserOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import type { BoardTask, TaskTypeOption } from "./task-board";

export type TaskFilterState = {
  q: string;
  /** "me" = 我负责的，"none" = 未指派，其余为用户 id */
  assignees: string[];
  priorities: string[];
  /** "none" = 未分类 */
  types: string[];
  /** "none" = 未关联里程碑 */
  milestones: string[];
  statuses: string[];
  /** overdue | today | week | none */
  due: string[];
};

export const EMPTY_TASK_FILTER: TaskFilterState = { q: "", assignees: [], priorities: [], types: [], milestones: [], statuses: [], due: [] };

export function isTaskFilterActive(f: TaskFilterState) {
  return !!f.q.trim() || f.assignees.length + f.priorities.length + f.types.length + f.milestones.length + f.statuses.length + f.due.length > 0;
}

const DUE_OPTIONS = [
  { value: "overdue", label: "已逾期" },
  { value: "today", label: "今天到期" },
  { value: "week", label: "本周到期" },
  { value: "none", label: "无截止日期" },
];

export function matchTask(t: BoardTask, f: TaskFilterState, meId: string, now = new Date()) {
  const q = f.q.trim().toLowerCase();
  if (q && !t.title.toLowerCase().includes(q)) return false;
  if (f.assignees.length) {
    const ok = f.assignees.some((a) => (a === "me" ? t.assigneeId === meId : a === "none" ? !t.assigneeId : t.assigneeId === a));
    if (!ok) return false;
  }
  if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
  if (f.types.length && !f.types.includes(t.typeId ?? "none")) return false;
  if (f.milestones.length && !f.milestones.includes(t.milestoneId ?? "none")) return false;
  if (f.statuses.length && !f.statuses.includes(t.status)) return false;
  if (f.due.length) {
    const b = dueBucket(t.dueDate, now);
    const ok = f.due.some((d) =>
      d === "overdue" ? b === "overdue" && t.status !== "DONE" : d === "today" ? b === "today" : d === "week" ? b === "today" || b === "week" : b === "none",
    );
    if (!ok) return false;
  }
  return true;
}

type Option = { value: string; label: ReactNode };

function FilterChip({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  const on = value.length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[13px] transition-colors",
            on ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover hover:text-ink",
          )}
        >
          {label}
          {on && <span className="rounded bg-accent px-1 text-[11px] leading-4 text-white">{value.length}</span>}
          <ChevronDown className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-80 w-56 overflow-y-auto p-1">
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <label key={o.value} className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-hover">
              <input
                type="checkbox"
                className="size-3.5 accent-accent"
                checked={checked}
                onChange={() => onChange(checked ? value.filter((x) => x !== o.value) : [...value, o.value])}
              />
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{o.label}</span>
            </label>
          );
        })}
        {on && (
          <button type="button" onClick={() => onChange([])} className="mt-1 h-7 w-full rounded border-t border-line text-xs text-ink-3 hover:text-ink">
            清除
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TaskFilterBar({
  value,
  onChange,
  members,
  types,
  milestones,
  showStatus,
  summary,
  actions,
}: {
  value: TaskFilterState;
  onChange: (v: TaskFilterState) => void;
  members: UserOption[];
  types: TaskTypeOption[];
  milestones: { id: string; name: string }[];
  /** 看板按状态分列，仍允许筛选状态以隐藏某些列中的卡片 */
  showStatus: boolean;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  const set = <K extends keyof TaskFilterState>(k: K) => (v: TaskFilterState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="relative max-md:w-full">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
        <input
          value={value.q}
          onChange={(e) => set("q")(e.target.value)}
          placeholder="搜索任务标题"
          className="h-8 w-52 rounded-md border max-md:w-full border-line bg-white pl-7 pr-2 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
        />
      </label>
      <FilterChip
        label="负责人"
        value={value.assignees}
        onChange={set("assignees")}
        options={[
          { value: "me", label: "我负责的" },
          { value: "none", label: <span className="text-ink-2">未指派</span> },
          ...members.map((m) => ({
            value: m.id,
            label: (
              <>
                <Avatar name={m.name} color={m.avatarColor} size={16} />
                {m.name}
              </>
            ),
          })),
        ]}
      />
      <FilterChip
        label="优先级"
        value={value.priorities}
        onChange={set("priorities")}
        options={TASK_PRIORITY_ORDER.map((p) => ({ value: p, label: <StatusBadge map={TASK_PRIORITY} value={p} /> }))}
      />
      <FilterChip
        label="类型"
        value={value.types}
        onChange={set("types")}
        options={[
          ...types.map((t) => ({ value: t.id, label: <Badge color={asTagColor(t.color)}>{t.name}</Badge> })),
          { value: "none", label: <span className="text-ink-2">未分类</span> },
        ]}
      />
      <FilterChip
        label="里程碑"
        value={value.milestones}
        onChange={set("milestones")}
        options={[...milestones.map((m) => ({ value: m.id, label: <>◆ {m.name}</> })), { value: "none", label: <span className="text-ink-2">未关联</span> }]}
      />
      {showStatus && (
        <FilterChip
          label="状态"
          value={value.statuses}
          onChange={set("statuses")}
          options={TASK_STATUS_ORDER.map((s) => ({ value: s, label: <StatusBadge map={TASK_STATUS} value={s} /> }))}
        />
      )}
      <FilterChip label="截止时间" value={value.due} onChange={set("due")} options={DUE_OPTIONS} />
      {isTaskFilterActive(value) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_TASK_FILTER)}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X className="size-3.5" />
          清除筛选
        </button>
      )}
      <span className="ml-auto flex items-center gap-2 text-xs text-ink-3">
        {summary}
        {actions}
      </span>
    </div>
  );
}
