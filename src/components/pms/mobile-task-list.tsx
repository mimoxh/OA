"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { TASK_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { isOverdue } from "@/lib/pms/utils";
import { cn } from "@/lib/utils";
import { PriorityTag, TaskTypeTag, useOpenTask, type BoardTask } from "./task-board";

const STATUS_ORDER = Object.keys(TASK_STATUS) as (keyof typeof TASK_STATUS)[];
const DOT: Record<keyof typeof TASK_STATUS, string> = {
  TODO: "bg-ink-3",
  IN_PROGRESS: "bg-accent",
  REVIEW: "bg-[#9065b0]",
  DONE: "bg-[#448361]",
};

/** 手机端项目任务：看板 / 列表 / 时间线统一换成按状态分组的列表，点任务进入全屏详情 */
export function MobileTaskList({ tasks, className }: { tasks: BoardTask[]; className?: string }) {
  const open = useOpenTask();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["DONE"]));
  const top = tasks.filter((t) => !t.parent);
  const toggle = (s: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div className={cn("space-y-3", className)} data-mobile-task-list>
      {top.length === 0 && <div className="rounded-lg border border-dashed border-line-strong py-10 text-center text-sm text-ink-3">没有任务</div>}
      {STATUS_ORDER.map((s) => {
        const list = top.filter((t) => t.status === s);
        if (!list.length) return null;
        const isCollapsed = collapsed.has(s);
        return (
          <section key={s} className="overflow-hidden rounded-lg border border-line bg-white">
            <button type="button" onClick={() => toggle(s)} className="flex h-10 w-full items-center gap-2 bg-sidebar px-3 text-left text-[13px] font-medium text-ink-2">
              {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
              <span className={cn("size-2 rounded-full", DOT[s])} />
              {TASK_STATUS[s].label}
              <span className="text-xs font-normal text-ink-3">{list.length}</span>
            </button>
            {!isCollapsed && (
              <ul className="divide-y divide-line">
                {list.map((t) => {
                  const overdue = isOverdue(t.dueDate, t.status);
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => open(t.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left active:bg-hover">
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-[15px] leading-snug text-ink", t.status === "DONE" && "text-ink-3 line-through")}>{t.title}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                            <TaskTypeTag type={t.type} />
                            <PriorityTag priority={t.priority} />
                            {t.dueDate && <span className={cn(overdue && "text-danger")}>{overdue ? "已逾期 · " : ""}{formatDate(t.dueDate, "MM-dd")} 截止</span>}
                            {t.subtaskTotal > 0 && (
                              <span>
                                子任务 {t.subtaskDone}/{t.subtaskTotal}
                              </span>
                            )}
                            {t.commentCount > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                <MessageSquare className="size-3" />
                                {t.commentCount}
                              </span>
                            )}
                          </span>
                        </span>
                        {t.assignee ? (
                          <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={24} className="mt-0.5" />
                        ) : (
                          <span className="mt-1 text-xs text-ink-3">未指派</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
