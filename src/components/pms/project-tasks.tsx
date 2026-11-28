"use client";

import { useState } from "react";
import type { UserOption } from "@/lib/crm/types";
import { TaskBoard, type BoardTask, type TaskTypeOption } from "./task-board";
import { TaskList } from "./task-list";
import { MobileTaskList } from "./mobile-task-list";
import { EMPTY_TASK_FILTER, isTaskFilterActive, matchTask, TaskFilterBar } from "./task-filter";
import { TaskTypesDialog } from "./task-types-dialog";

/** 项目的看板 / 列表视图与共用的筛选栏（切换视图时筛选条件保留）；手机上统一为按状态分组的任务列表 */
export function ProjectTasks({
  view,
  projectId,
  tasks,
  members,
  types,
  milestones,
  canEdit,
  canManage,
  meId,
}: {
  view: "board" | "list" | "mobile";
  projectId: string;
  tasks: BoardTask[];
  members: UserOption[];
  types: TaskTypeOption[];
  milestones: { id: string; name: string }[];
  canEdit: boolean;
  canManage: boolean;
  meId: string;
}) {
  const [filter, setFilter] = useState(EMPTY_TASK_FILTER);
  const active = isTaskFilterActive(filter);
  const matched = active ? tasks.filter((t) => matchTask(t, filter, meId)) : tasks;
  const usage: Record<string, number> = {};
  for (const t of tasks) if (t.typeId) usage[t.typeId] = (usage[t.typeId] ?? 0) + 1;
  return (
    <>
      <TaskFilterBar
        value={filter}
        onChange={setFilter}
        members={members}
        types={types}
        milestones={milestones}
        showStatus
        summary={active ? `筛选出 ${matched.length} / ${tasks.length} 个任务` : `共 ${tasks.length} 个任务`}
        actions={canManage ? <TaskTypesDialog projectId={projectId} types={types} usage={usage} /> : undefined}
      />
      {view !== "mobile" && (
        <div className="max-md:hidden">
          {view === "board" ? (
            <TaskBoard projectId={projectId} tasks={matched} canEdit={canEdit} />
          ) : (
            <TaskList tasks={tasks} visible={active ? new Set(matched.map((t) => t.id)) : null} members={members} types={types} canEdit={canEdit} />
          )}
        </div>
      )}
      <MobileTaskList tasks={matched} className="md:hidden" />
    </>
  );
}
