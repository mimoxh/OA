"use client";

import { CheckSquare } from "lucide-react";
import { StatusBadge, Dot } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { InlineDate, InlineSelect } from "@/components/crm/inline";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatDate, toDateInput } from "@/lib/format";
import { isOverdue, taskKey, TASK_STATUS_ORDER } from "@/lib/pms/utils";
import type { UserOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { updateTask, type TaskInput } from "@/app/(app)/pms/actions";
import { useOpenTask, type BoardTask } from "@/components/pms/task-board";

export type ListTask = BoardTask & { assigneeId: string | null };

export const statusOptions = TASK_STATUS_ORDER.map((s) => ({ value: s, label: <StatusBadge map={TASK_STATUS} value={s} /> }));
export const priorityOptions = (Object.keys(TASK_PRIORITY) as (keyof typeof TASK_PRIORITY)[]).map((p) => ({
  value: p,
  label: <StatusBadge map={TASK_PRIORITY} value={p} />,
}));

export function TaskList({ code, tasks, members, canEdit }: { code: string; tasks: ListTask[]; members: UserOption[]; canEdit: boolean }) {
  const openTask = useOpenTask();
  const ro = !canEdit;
  const save = (id: string, patch: TaskInput) => updateTask(id, patch);
  const memberOptions = members.map((u) => ({ value: u.id, label: <UserChip name={u.name} color={u.avatarColor} /> }));
  return (
    <div className="space-y-6">
      {TASK_STATUS_ORDER.map((status) => {
        const rows = tasks.filter((t) => t.status === status).sort((a, b) => a.sortOrder - b.sortOrder);
        return (
          <section key={status}>
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <Dot color={TASK_STATUS[status].color} />
              {TASK_STATUS[status].label}
              <span className="text-xs font-normal text-ink-3">{rows.length}</span>
            </h3>
            <Table>
              <THead>
                <TR>
                  <TH className="w-24">编号</TH>
                  <TH>标题</TH>
                  <TH className="w-28">状态</TH>
                  <TH className="w-24">优先级</TH>
                  <TH className="w-32">负责人</TH>
                  <TH className="w-36">截止日期</TH>
                  <TH className="w-16 text-right">子任务</TH>
                </TR>
              </THead>
              <TBody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-center text-xs text-ink-3">
                      暂无任务
                    </td>
                  </tr>
                )}
                {rows.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs text-ink-3">{taskKey(code, t.no)}</TD>
                    <TD>
                      <button onClick={() => openTask(t.id)} className={cn("text-left hover:text-accent hover:underline", t.status === "DONE" && "text-ink-2 line-through")}>
                        {t.title}
                      </button>
                    </TD>
                    <TD>
                      <InlineSelect readOnly={ro} value={t.status} options={statusOptions} onSave={(v) => save(t.id, { status: v as "TODO" })} />
                    </TD>
                    <TD>
                      <InlineSelect readOnly={ro} value={t.priority} options={priorityOptions} onSave={(v) => save(t.id, { priority: v as "LOW" })} />
                    </TD>
                    <TD>
                      <InlineSelect
                        readOnly={ro}
                        allowEmpty
                        emptyLabel="取消指派"
                        placeholder="未指派"
                        value={t.assigneeId}
                        options={memberOptions}
                        onSave={(v) => save(t.id, { assigneeId: v || null })}
                      />
                    </TD>
                    <TD>
                      <InlineDate
                        readOnly={ro}
                        value={toDateInput(t.dueDate)}
                        display={formatDate(t.dueDate)}
                        className={cn(isOverdue(t.dueDate, t.status) && "text-danger")}
                        onSave={(v) => save(t.id, { dueDate: v || null })}
                      />
                    </TD>
                    <TD className="text-right text-xs text-ink-2">
                      {t.subtaskTotal > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckSquare className="size-3" />
                          {t.subtaskDone}/{t.subtaskTotal}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}
