"use client";

import { useState } from "react";
import { CheckSquare, ChevronRight, CornerDownRight } from "lucide-react";
import { StatusBadge, Dot, Badge } from "@/components/ui/badge";
import { UserChip } from "@/components/ui/avatar";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { InlineDate, InlineSelect } from "@/components/crm/inline";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatDate, toDateInput } from "@/lib/format";
import { asTagColor, isOverdue, TASK_STATUS_ORDER } from "@/lib/pms/utils";
import type { UserOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { updateTask, type TaskInput } from "@/app/(app)/pms/actions";
import { useOpenTask, type BoardTask, type TaskTypeOption } from "@/components/pms/task-board";

export const statusOptions = TASK_STATUS_ORDER.map((s) => ({ value: s, label: <StatusBadge map={TASK_STATUS} value={s} /> }));
export const priorityOptions = (Object.keys(TASK_PRIORITY) as (keyof typeof TASK_PRIORITY)[]).map((p) => ({
  value: p,
  label: <StatusBadge map={TASK_PRIORITY} value={p} />,
}));
export function typeOptions(types: TaskTypeOption[]) {
  return types.map((t) => ({ value: t.id, label: <Badge color={asTagColor(t.color)}>{t.name}</Badge> }));
}

/**
 * 按状态分组的任务列表；子任务缩进显示在父任务下方，可以展开收起。
 * visible 为筛选命中的任务 id（null 表示没有筛选）：父任务未命中但有子任务命中时，父任务以淡色显示作为上下文。
 */
export function TaskList({
  tasks,
  visible,
  members,
  types,
  canEdit,
}: {
  tasks: BoardTask[];
  visible: Set<string> | null;
  members: UserOption[];
  types: TaskTypeOption[];
  canEdit: boolean;
}) {
  const openTask = useOpenTask();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ro = !canEdit;
  const save = (id: string, patch: TaskInput) => updateTask(id, patch);
  const memberOptions = members.map((u) => ({ value: u.id, label: <UserChip name={u.name} color={u.avatarColor} /> }));
  const typeOpts = typeOptions(types);
  const hit = (id: string) => !visible || visible.has(id);
  const bySort = (a: BoardTask, b: BoardTask) => a.sortOrder - b.sortOrder;
  const childrenOf = new Map<string, BoardTask[]>();
  for (const t of tasks) {
    if (!t.parent) continue;
    childrenOf.set(t.parent.id, [...(childrenOf.get(t.parent.id) ?? []), t]);
  }
  const topIds = new Set(tasks.filter((t) => !t.parent).map((t) => t.id));
  // 父任务已不在列表中的子任务（理论上不会出现）当作顶层任务显示
  const tops = tasks.filter((t) => !t.parent || !topIds.has(t.parent.id));

  const row = (t: BoardTask, sub: boolean, context: boolean, kids: BoardTask[]) => {
    const open = !collapsed.has(t.id);
    return (
      <TR key={t.id} className={cn(context && "opacity-55")}>
        <TD>
          <div className={cn("flex min-w-0 items-center gap-1.5", sub && "pl-6")}>
            {sub ? (
              <CornerDownRight className="size-3.5 shrink-0 text-ink-3" />
            ) : kids.length > 0 ? (
              <button
                type="button"
                aria-label={open ? "收起子任务" : "展开子任务"}
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s);
                    if (n.has(t.id)) n.delete(t.id);
                    else n.add(t.id);
                    return n;
                  })
                }
                className="flex size-4 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
              >
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
              </button>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <button
              onClick={() => openTask(t.id)}
              className={cn("min-w-0 truncate text-left hover:text-accent hover:underline", t.status === "DONE" && "text-ink-2 line-through")}
            >
              {t.title}
            </button>
          </div>
        </TD>
        <TD>
          <InlineSelect
            readOnly={ro}
            allowEmpty
            emptyLabel="未分类"
            placeholder="未分类"
            value={t.typeId}
            options={typeOpts}
            onSave={(v) => save(t.id, { typeId: v || null })}
          />
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
          {!sub && t.subtaskTotal > 0 ? (
            <span className="inline-flex items-center gap-1">
              <CheckSquare className="size-3" />
              {t.subtaskDone}/{t.subtaskTotal}
            </span>
          ) : (
            "—"
          )}
        </TD>
      </TR>
    );
  };

  return (
    <div className="space-y-6">
      {TASK_STATUS_ORDER.map((status) => {
        const groups = tops
          .filter((t) => t.status === status)
          .sort(bySort)
          .flatMap((t) => {
            const kids = (childrenOf.get(t.id) ?? []).sort(bySort);
            const shownKids = visible ? kids.filter((k) => hit(k.id)) : kids;
            if (!hit(t.id) && shownKids.length === 0) return [];
            return [{ t, kids, shownKids, context: !hit(t.id) }];
          });
        if (visible && groups.length === 0) return null;
        const count = groups.reduce((n, g) => n + 1 + g.shownKids.length, 0);
        return (
          <section key={status}>
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <Dot color={TASK_STATUS[status].color} />
              {TASK_STATUS[status].label}
              <span className="text-xs font-normal text-ink-3">{count}</span>
            </h3>
            <Table>
              <THead>
                <TR>
                  <TH>标题</TH>
                  <TH className="w-28">类型</TH>
                  <TH className="w-28">状态</TH>
                  <TH className="w-24">优先级</TH>
                  <TH className="w-32">负责人</TH>
                  <TH className="w-36">截止日期</TH>
                  <TH className="w-16 text-right">子任务</TH>
                </TR>
              </THead>
              <TBody>
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-center text-xs text-ink-3">
                      暂无任务
                    </td>
                  </tr>
                )}
                {groups.flatMap(({ t, kids, shownKids, context }) => [
                  row(t, false, context, visible ? shownKids : kids),
                  ...(collapsed.has(t.id) ? [] : shownKids.map((k) => row(k, true, false, []))),
                ])}
              </TBody>
            </Table>
          </section>
        );
      })}
      {visible && visible.size === 0 && <div className="py-10 text-center text-sm text-ink-3">没有符合筛选条件的任务</div>}
    </div>
  );
}
