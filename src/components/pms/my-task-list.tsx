"use client";

import Link from "next/link";
import { InlineSelect } from "@/components/crm/inline";
import { TASK_STATUS, type TASK_PRIORITY } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { isOverdue } from "@/lib/pms/utils";
import { cn } from "@/lib/utils";
import { updateTask } from "@/app/(app)/pms/actions";
import { statusOptions } from "@/components/pms/task-list";
import { PriorityTag } from "@/components/pms/task-board";

export type MyTask = {
  id: string;
  title: string;
  status: keyof typeof TASK_STATUS;
  priority: keyof typeof TASK_PRIORITY;
  dueDate: Date | null;
  completedAt: Date | null;
  parentTitle: string | null;
  project: { id: string; name: string; icon: string };
};

export function MyTaskList({ tasks }: { tasks: MyTask[] }) {
  return (
    <div className="divide-y divide-line rounded-lg border border-line bg-white">
      {tasks.map((t) => {
        const overdue = isOverdue(t.dueDate, t.status);
        return (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-sidebar">
            <div className="w-28 shrink-0">
              <InlineSelect value={t.status} options={statusOptions} onSave={(v) => updateTask(t.id, { status: v as "TODO" })} />
            </div>
            <div className="min-w-0 flex-1">
              <Link
                href={`/pms/projects/${t.project.id}?task=${t.id}`}
                className={cn("block truncate text-sm hover:text-accent hover:underline", t.status === "DONE" && "text-ink-2 line-through")}
              >
                {t.title}
              </Link>
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-3">
                <span className="truncate">
                  {t.project.icon} {t.project.name}
                </span>
                {t.parentTitle && <span className="truncate">· 父任务：{t.parentTitle}</span>}
              </div>
            </div>
            <PriorityTag priority={t.priority} />
            <div className={cn("w-24 shrink-0 text-right text-xs tabular-nums", overdue ? "font-medium text-danger" : "text-ink-2")}>
              {t.status === "DONE" && t.completedAt ? `完成于 ${formatDate(t.completedAt)}` : t.dueDate ? formatDate(t.dueDate) : "—"}
            </div>
          </div>
        );
      })}
      {tasks.length === 0 && <div className="py-6 text-center text-xs text-ink-3">暂无任务</div>}
    </div>
  );
}
