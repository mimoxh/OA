"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CheckSquare, CornerDownRight, MessageSquare, Plus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Dot } from "@/components/ui/badge";
import { useAction } from "@/components/ui/use-action";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { asTagColor, between, isOverdue, TASK_STATUS_ORDER } from "@/lib/pms/utils";
import { cn } from "@/lib/utils";
import { createTask, moveTask } from "@/app/(app)/pms/actions";

type Status = (typeof TASK_STATUS_ORDER)[number];

export type TaskTypeOption = { id: string; name: string; color: string };

export type BoardTask = {
  id: string;
  title: string;
  parent: { id: string; title: string } | null;
  type: TaskTypeOption | null;
  typeId: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  status: Status;
  priority: keyof typeof TASK_PRIORITY;
  sortOrder: number;
  dueDate: Date | null;
  assignee: { name: string; avatarColor: string } | null;
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
  milestone: string | null;
};

export function useOpenTask() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("task", id);
    router.push(`${pathname}?${next}`, { scroll: false });
  };
}

export function PriorityTag({ priority }: { priority: keyof typeof TASK_PRIORITY }) {
  if (priority === "MEDIUM" || priority === "LOW") return null;
  return <Badge color={TASK_PRIORITY[priority].color}>{TASK_PRIORITY[priority].label}</Badge>;
}

export function TaskTypeTag({ type }: { type: TaskTypeOption | null }) {
  if (!type) return null;
  return <Badge color={asTagColor(type.color)}>{type.name}</Badge>;
}

export function TaskBoard({ projectId, tasks, canEdit }: { projectId: string; tasks: BoardTask[]; canEdit: boolean }) {
  const openTask = useOpenTask();
  const { run } = useAction();
  const [overrides, setOverrides] = useState<Record<string, { status: Status; sortOrder: number }>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ status: Status; index: number } | null>(null);
  const [adding, setAdding] = useState<Status | null>(null);
  const [draft, setDraft] = useState("");

  const list = tasks
    .map((t) => (overrides[t.id] ? { ...t, ...overrides[t.id] } : t))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const column = (s: Status) => list.filter((t) => t.status === s);

  const drop = (status: Status, index: number) => {
    const id = dragId;
    setDragId(null);
    setDropAt(null);
    if (!id) return;
    const dragged = list.find((t) => t.id === id);
    if (!dragged) return;
    const col = column(status);
    const from = col.findIndex((t) => t.id === id);
    if (from >= 0 && (index === from || index === from + 1)) return;
    const others = col.filter((t) => t.id !== id);
    const at = from >= 0 && from < index ? index - 1 : index;
    const sortOrder = between(others[at - 1]?.sortOrder, others[at]?.sortOrder);
    const prev = { status: dragged.status, sortOrder: dragged.sortOrder };
    setOverrides((m) => ({ ...m, [id]: { status, sortOrder } }));
    run(() => moveTask(id, status, sortOrder), dragged.status !== status ? { success: `已移动到「${TASK_STATUS[status].label}」` } : {}).then((r) => {
      if (!r.ok) setOverrides((m) => ({ ...m, [id]: prev }));
    });
  };

  const quickAdd = (status: Status) => {
    const title = draft.trim();
    if (!title) {
      setAdding(null);
      return;
    }
    setDraft("");
    run(() => createTask(projectId, { title, status }), { success: "任务已创建" });
  };

  return (
    <div className="-mx-6 overflow-x-auto px-6 pb-6 sm:-mx-12 sm:px-12">
      <div className="flex min-w-max gap-3">
        {TASK_STATUS_ORDER.map((status) => {
          const cards = column(status);
          const meta = TASK_STATUS[status];
          const indicatorAt = dropAt?.status === status ? dropAt.index : -1;
          return (
            <div
              key={status}
              data-status={status}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if ((e.target as HTMLElement).closest("[data-task-card]")) return;
                if (dropAt?.status !== status || dropAt.index !== cards.length) setDropAt({ status, index: cards.length });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(status, dropAt?.status === status ? dropAt.index : cards.length);
              }}
              className={cn("flex w-[280px] shrink-0 flex-col rounded-lg bg-sidebar p-2", dropAt?.status === status && "bg-accent-soft/60")}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Dot color={meta.color} />
                  {meta.label}
                  <span className="text-xs font-normal text-ink-3">{cards.length}</span>
                </span>
              </div>
              <div className="flex min-h-20 flex-1 flex-col">
                {cards.map((t, i) => (
                  <div key={t.id}>
                    {indicatorAt === i && <div className="mb-1.5 h-0.5 rounded-full bg-accent" />}
                    <div
                      data-task-card
                      data-id={t.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropAt(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const index = e.clientY < r.top + r.height / 2 ? i : i + 1;
                        if (dropAt?.status !== status || dropAt.index !== index) setDropAt({ status, index });
                      }}
                      onClick={() => openTask(t.id)}
                      className={cn(
                        "mb-1.5 cursor-pointer rounded-md border border-line bg-white p-2.5 shadow-card transition hover:border-line-strong hover:shadow-sm",
                        dragId === t.id && "opacity-40",
                      )}
                    >
                      {t.parent && (
                        <div className="mb-1 flex items-center gap-1 text-[11px] text-ink-3" title={`父任务：${t.parent.title}`}>
                          <CornerDownRight className="size-3 shrink-0" />
                          <span className="truncate">{t.parent.title}</span>
                        </div>
                      )}
                      {(t.type || t.priority === "HIGH" || t.priority === "URGENT") && (
                        <div className="mb-1 flex items-center gap-1">
                          <TaskTypeTag type={t.type} />
                          <PriorityTag priority={t.priority} />
                        </div>
                      )}
                      <div className={cn("text-sm leading-snug text-ink", t.status === "DONE" && "text-ink-2 line-through decoration-ink-3")}>{t.title}</div>
                      {t.milestone && <div className="mt-1 truncate text-[11px] text-ink-3">◆ {t.milestone}</div>}
                      <div className="mt-2 flex items-center gap-2.5 text-xs text-ink-2">
                        {t.dueDate && (
                          <span className={cn("inline-flex items-center gap-1", isOverdue(t.dueDate, t.status) && "font-medium text-danger")}>
                            <CalendarDays className="size-3" />
                            {formatDate(t.dueDate, "MM-dd")}
                          </span>
                        )}
                        {t.subtaskTotal > 0 && (
                          <span className={cn("inline-flex items-center gap-1", t.subtaskDone === t.subtaskTotal && "text-[#448361]")}>
                            <CheckSquare className="size-3" />
                            {t.subtaskDone}/{t.subtaskTotal}
                          </span>
                        )}
                        {t.commentCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="size-3" />
                            {t.commentCount}
                          </span>
                        )}
                        <span className="ml-auto">{t.assignee && <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={20} />}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {indicatorAt === cards.length && <div className="mb-1.5 h-0.5 rounded-full bg-accent" />}
                {canEdit &&
                  (adding === status ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        if (!draft.trim()) setAdding(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          quickAdd(status);
                        }
                        if (e.key === "Escape") {
                          setDraft("");
                          setAdding(null);
                        }
                      }}
                      placeholder="输入标题，回车创建"
                      className="h-9 rounded-md border border-accent bg-white px-2.5 text-sm outline-none ring-[3px] ring-accent/15"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setDraft("");
                        setAdding(status);
                      }}
                      className="flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-ink-3 hover:bg-active hover:text-ink"
                    >
                      <Plus className="size-3.5" />
                      添加任务
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
