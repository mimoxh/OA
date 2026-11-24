"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { runAction } from "@/lib/action";
import type { CurrentUser } from "@/lib/auth/dal";
import { nextCode } from "@/lib/sequence";
import { audit, notify } from "@/lib/services/notify";
import { MILESTONE_STATUS, PROJECT_STATUS, TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatDate, parseDateInput } from "@/lib/format";
import { parseInput, pickProvided } from "@/lib/crm/validate";
import { assertEditTasks, assertManageProject } from "@/lib/pms/access";
import { PROJECT_MEMBER_ROLE, taskKey } from "@/lib/pms/utils";

const optStr = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `内容不能超过 ${max} 个字符`)
    .nullish()
    .transform((v) => (v ? v : null));
const optDate = z
  .string()
  .nullish()
  .transform((v) => parseDateInput(v ?? null));

const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const ROLES = ["owner", "member", "viewer"] as const;

function revalidatePms() {
  revalidatePath("/pms", "layout");
}

function taskLink(projectId: string, taskId: string) {
  return `/pms/projects/${projectId}?task=${taskId}`;
}

function docJson(title: string, description: string | null) {
  const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
  const h = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
  const blocks = [h("项目背景"), p(description ?? ""), h("目标与范围"), p(""), h("会议纪要"), p("")];
  const text = [title, "项目背景", description ?? "", "目标与范围", "会议纪要"].filter(Boolean).join(" ");
  return { content: JSON.stringify({ type: "doc", content: blocks }), text };
}

// ───────────── 项目 ─────────────

const projectSchema = z
  .object({
    name: z.string().trim().min(1, "请填写项目名称").max(100, "项目名称过长"),
    description: optStr(2000),
    icon: z.string().trim().min(1).max(8).default("🚀"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确").default("#2383e2"),
    status: z.enum(PROJECT_STATUSES).default("PLANNING"),
    ownerId: z.string().min(1, "请选择项目负责人"),
    customerId: optStr(50),
    startDate: optDate,
    endDate: optDate,
    budget: z.coerce.number({ error: "预算必须是数字" }).min(0, "预算不能为负数").default(0),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, "结束日期不能早于开始日期");

export type ProjectInput = z.input<typeof projectSchema> & { memberIds?: string[]; createDoc?: boolean };

export async function createProject(input: ProjectInput) {
  return runAction("pms:edit", async (user) => {
    const data = parseInput(projectSchema, input);
    const memberIds = [...new Set((input.memberIds ?? []).filter((id) => id && id !== data.ownerId))];
    const project = await db.$transaction(async (tx) => {
      let documentId: string | null = null;
      if (input.createDoc) {
        const space = await tx.space.findFirst({
          where: { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: user.id } } }] },
          orderBy: { sortOrder: "asc" },
        });
        if (!space) throw new Error("没有可用的文档空间，无法创建项目文档");
        const title = `${data.name} 项目文档`;
        const { content, text } = docJson(title, data.description);
        const doc = await tx.document.create({
          data: { spaceId: space.id, title, icon: data.icon, content, text, createdById: user.id, updatedById: user.id },
        });
        documentId = doc.id;
      }
      const code = await nextCode(tx, "PRJ", 3);
      const p = await tx.project.create({
        data: {
          ...data,
          code,
          documentId,
          members: {
            create: [{ userId: data.ownerId, role: "owner" }, ...memberIds.map((userId) => ({ userId, role: "member" }))],
          },
        },
      });
      await audit(tx, { entityType: "project", entityId: p.id, action: "created", detail: p.name, userId: user.id });
      await notify(tx, {
        userIds: [data.ownerId, ...memberIds],
        actorId: user.id,
        type: "task",
        title: `${user.name} 邀请你加入项目「${p.name}」`,
        link: `/pms/projects/${p.id}`,
      });
      return p;
    });
    revalidatePms();
    return { id: project.id };
  });
}

export async function updateProject(id: string, input: Partial<z.input<typeof projectSchema>>) {
  return runAction("pms:view", async (user) => {
    await assertManageProject(user, id);
    const data = parseInput(projectSchema.partial(), input);
    const patch = pickProvided(data, input);
    const before = await db.project.findUnique({ where: { id } });
    if (!before) throw new Error("项目不存在");
    const start = patch.startDate !== undefined ? patch.startDate : before.startDate;
    const end = patch.endDate !== undefined ? patch.endDate : before.endDate;
    if (start && end && start > end) throw new Error("结束日期不能早于开始日期");
    await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: patch });
      if (patch.ownerId && patch.ownerId !== before.ownerId) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: id, userId: patch.ownerId } },
          create: { projectId: id, userId: patch.ownerId, role: "owner" },
          update: { role: "owner" },
        });
        await tx.projectMember.updateMany({ where: { projectId: id, userId: before.ownerId }, data: { role: "member" } });
        await notify(tx, {
          userIds: [patch.ownerId],
          actorId: user.id,
          type: "task",
          title: `${user.name} 将项目「${before.name}」的负责人设为你`,
          link: `/pms/projects/${id}`,
        });
      }
      const detail = patch.status ? `状态变更为「${PROJECT_STATUS[patch.status].label}」` : `更新了 ${Object.keys(patch).join("、")}`;
      await audit(tx, { entityType: "project", entityId: id, action: "updated", detail, userId: user.id });
    });
    revalidatePms();
  });
}

export async function deleteProject(id: string) {
  return runAction("pms:edit", async (user) => {
    const p = await db.project.findUnique({ where: { id } });
    if (!p) throw new Error("项目不存在");
    await db.$transaction(async (tx) => {
      const taskIds = (await tx.task.findMany({ where: { projectId: id }, select: { id: true } })).map((t) => t.id);
      await tx.comment.deleteMany({ where: { targetType: "task", targetId: { in: taskIds } } });
      await tx.project.delete({ where: { id } });
      await audit(tx, { entityType: "project", entityId: id, action: "deleted", detail: p.name, userId: user.id });
    });
    revalidatePms();
  });
}

export async function createProjectDocument(projectId: string) {
  return runAction("pms:view", async (user) => {
    await assertManageProject(user, projectId);
    const p = await db.project.findUnique({ where: { id: projectId } });
    if (!p) throw new Error("项目不存在");
    if (p.documentId) throw new Error("项目已有关联文档");
    const docId = await db.$transaction(async (tx) => {
      const space = await tx.space.findFirst({
        where: { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: user.id } } }] },
        orderBy: { sortOrder: "asc" },
      });
      if (!space) throw new Error("没有可用的文档空间");
      const title = `${p.name} 项目文档`;
      const { content, text } = docJson(title, p.description);
      const doc = await tx.document.create({ data: { spaceId: space.id, title, icon: p.icon, content, text, createdById: user.id, updatedById: user.id } });
      await tx.project.update({ where: { id: p.id }, data: { documentId: doc.id } });
      return doc.id;
    });
    revalidatePms();
    return { documentId: docId };
  });
}

// ───────────── 成员 ─────────────

export async function addProjectMember(projectId: string, userId: string, role: string) {
  return runAction("pms:view", async (user) => {
    await assertManageProject(user, projectId);
    const r = parseInput(z.enum(ROLES, { error: "角色不正确" }), role);
    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target || !target.active) throw new Error("用户不存在或已停用");
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    await db.$transaction(async (tx) => {
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { projectId, userId, role: r },
        update: { role: r },
      });
      await notify(tx, { userIds: [userId], actorId: user.id, type: "task", title: `${user.name} 邀请你加入项目「${project.name}」`, link: `/pms/projects/${projectId}` });
      await audit(tx, { entityType: "project", entityId: projectId, action: "member_added", detail: `${target.name}（${PROJECT_MEMBER_ROLE[r]}）`, userId: user.id });
    });
    revalidatePms();
  });
}

export async function updateProjectMember(memberId: string, role: string) {
  return runAction("pms:view", async (user) => {
    const m = await db.projectMember.findUnique({ where: { id: memberId }, include: { project: true } });
    if (!m) throw new Error("成员不存在");
    await assertManageProject(user, m.projectId);
    const r = parseInput(z.enum(ROLES), role);
    if (m.userId === m.project.ownerId && r !== "owner") throw new Error("项目负责人的角色不能修改，请先更换负责人");
    await db.projectMember.update({ where: { id: memberId }, data: { role: r } });
    revalidatePms();
  });
}

export async function removeProjectMember(memberId: string) {
  return runAction("pms:view", async (user) => {
    const m = await db.projectMember.findUnique({ where: { id: memberId }, include: { project: true, user: true } });
    if (!m) throw new Error("成员不存在");
    await assertManageProject(user, m.projectId);
    if (m.userId === m.project.ownerId) throw new Error("不能移除项目负责人");
    await db.$transaction(async (tx) => {
      await tx.projectMember.delete({ where: { id: memberId } });
      await audit(tx, { entityType: "project", entityId: m.projectId, action: "member_removed", detail: m.user.name, userId: user.id });
    });
    revalidatePms();
  });
}

// ───────────── 里程碑 ─────────────

const milestoneSchema = z.object({
  name: z.string().trim().min(1, "请填写里程碑名称").max(100),
  description: optStr(1000),
  dueDate: optDate,
  status: z.enum(["OPEN", "DONE"]).optional(),
});
export type MilestoneInput = z.input<typeof milestoneSchema>;

export async function createMilestone(projectId: string, input: MilestoneInput) {
  return runAction("pms:view", async (user) => {
    await assertManageProject(user, projectId);
    const data = parseInput(milestoneSchema, input);
    await db.milestone.create({ data: { ...data, projectId } });
    revalidatePms();
  });
}

export async function updateMilestone(id: string, input: Partial<MilestoneInput>) {
  return runAction("pms:view", async (user) => {
    const m = await db.milestone.findUnique({ where: { id } });
    if (!m) throw new Error("里程碑不存在");
    await assertManageProject(user, m.projectId);
    const data = parseInput(milestoneSchema.partial(), input);
    const patch = pickProvided(data, input);
    await db.$transaction(async (tx) => {
      await tx.milestone.update({ where: { id }, data: patch });
      if (patch.status && patch.status !== m.status) {
        await audit(tx, {
          entityType: "project",
          entityId: m.projectId,
          action: "milestone",
          detail: `里程碑「${m.name}」${MILESTONE_STATUS[patch.status].label}`,
          userId: user.id,
        });
      }
    });
    revalidatePms();
  });
}

export async function deleteMilestone(id: string) {
  return runAction("pms:view", async (user) => {
    const m = await db.milestone.findUnique({ where: { id } });
    if (!m) throw new Error("里程碑不存在");
    await assertManageProject(user, m.projectId);
    await db.milestone.delete({ where: { id } });
    revalidatePms();
  });
}

// ───────────── 任务 ─────────────

const taskSchema = z.object({
  title: z.string().trim().min(1, "请填写任务标题").max(200, "标题过长"),
  description: optStr(5000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  assigneeId: optStr(50),
  startDate: optDate,
  dueDate: optDate,
  estimateHours: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 10000) {
        ctx.addIssue({ code: "custom", message: "预估工时必须是 0-10000 之间的数字" });
        return z.NEVER;
      }
      return n;
    }),
  milestoneId: optStr(50),
  parentId: optStr(50),
});
export type TaskInput = Partial<z.input<typeof taskSchema>>;

async function checkTaskRefs(tx: Tx, projectId: string, data: Partial<z.output<typeof taskSchema>>, taskId?: string) {
  if (data.assigneeId) {
    const u = await tx.user.findUnique({ where: { id: data.assigneeId } });
    if (!u || !u.active) throw new Error("负责人不存在或已停用");
  }
  if (data.milestoneId) {
    const m = await tx.milestone.findUnique({ where: { id: data.milestoneId } });
    if (!m || m.projectId !== projectId) throw new Error("里程碑不属于该项目");
  }
  if (data.parentId) {
    if (data.parentId === taskId) throw new Error("不能把任务设为自己的父任务");
    const p = await tx.task.findUnique({ where: { id: data.parentId } });
    if (!p || p.projectId !== projectId) throw new Error("父任务不属于该项目");
    if (p.parentId) throw new Error("只支持两级任务，不能选择子任务作为父任务");
    if (taskId && (await tx.task.count({ where: { parentId: taskId } })) > 0) throw new Error("该任务已有子任务，不能再设为子任务");
  }
}

async function notifyAssignee(tx: Tx, user: CurrentUser, task: { id: string; projectId: string; title: string; no: number }, code: string, assigneeId: string | null) {
  if (!assigneeId) return;
  await notify(tx, {
    userIds: [assigneeId],
    actorId: user.id,
    type: "task",
    title: `${user.name} 将任务「${taskKey(code, task.no)} ${task.title}」指派给你`,
    link: taskLink(task.projectId, task.id),
  });
}

export async function createTask(projectId: string, input: TaskInput) {
  return runAction("pms:view", async (user) => {
    await assertEditTasks(user, projectId);
    const data = parseInput(taskSchema, { ...input, status: input.status ?? "TODO", priority: input.priority ?? "MEDIUM" });
    if (data.startDate && data.dueDate && data.startDate > data.dueDate) throw new Error("截止日期不能早于开始日期");
    const task = await db.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project) throw new Error("项目不存在");
      await checkTaskRefs(tx, projectId, data);
      const agg = await tx.task.aggregate({ where: { projectId }, _max: { no: true } });
      const last = await tx.task.aggregate({ where: { projectId, status: data.status, parentId: data.parentId }, _max: { sortOrder: true } });
      const t = await tx.task.create({
        data: {
          ...data,
          projectId,
          no: (agg._max.no ?? 0) + 1,
          reporterId: user.id,
          sortOrder: (last._max.sortOrder ?? 0) + 1000,
          completedAt: data.status === "DONE" ? new Date() : null,
        },
      });
      await audit(tx, { entityType: "task", entityId: t.id, action: "created", detail: "创建了任务", userId: user.id });
      if (data.parentId) {
        await audit(tx, { entityType: "task", entityId: data.parentId, action: "subtask", detail: `添加了子任务「${t.title}」`, userId: user.id });
      }
      await notifyAssignee(tx, user, t, project.code, t.assigneeId);
      return t;
    });
    revalidatePms();
    return { id: task.id };
  });
}

export async function updateTask(id: string, input: TaskInput) {
  return runAction("pms:view", async (user) => {
    const before = await db.task.findUnique({ where: { id }, include: { project: true, assignee: true, milestone: true } });
    if (!before) throw new Error("任务不存在");
    await assertEditTasks(user, before.projectId);
    const data = parseInput(taskSchema.partial(), input);
    const patch = pickProvided(data, input);
    const start = patch.startDate !== undefined ? patch.startDate : before.startDate;
    const due = patch.dueDate !== undefined ? patch.dueDate : before.dueDate;
    if (start && due && start > due) throw new Error("截止日期不能早于开始日期");

    await db.$transaction(async (tx) => {
      await checkTaskRefs(tx, before.projectId, patch, id);
      const extra: Prisma.TaskUncheckedUpdateInput = {};
      if (patch.status && patch.status !== before.status) {
        extra.completedAt = patch.status === "DONE" ? new Date() : null;
        if (!("sortOrder" in input)) {
          const last = await tx.task.aggregate({ where: { projectId: before.projectId, status: patch.status, parentId: before.parentId }, _max: { sortOrder: true } });
          extra.sortOrder = (last._max.sortOrder ?? 0) + 1000;
        }
      }
      await tx.task.update({ where: { id }, data: { ...patch, ...extra } });

      const changes: string[] = [];
      if (patch.title !== undefined && patch.title !== before.title) changes.push(`将标题改为「${patch.title}」`);
      if (patch.description !== undefined && patch.description !== before.description) changes.push("更新了描述");
      if (patch.status && patch.status !== before.status)
        changes.push(`将状态从「${TASK_STATUS[before.status].label}」改为「${TASK_STATUS[patch.status].label}」`);
      if (patch.priority && patch.priority !== before.priority) changes.push(`将优先级改为「${TASK_PRIORITY[patch.priority].label}」`);
      if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
        const u = patch.assigneeId ? await tx.user.findUnique({ where: { id: patch.assigneeId } }) : null;
        changes.push(u ? `将任务指派给 ${u.name}` : "取消了指派");
        if (u && u.id !== user.id) await notifyAssignee(tx, user, before, before.project.code, u.id);
      }
      if (patch.startDate !== undefined && +(patch.startDate ?? 0) !== +(before.startDate ?? 0))
        changes.push(patch.startDate ? `将开始日期设为 ${formatDate(patch.startDate)}` : "清除了开始日期");
      if (patch.dueDate !== undefined && +(patch.dueDate ?? 0) !== +(before.dueDate ?? 0))
        changes.push(patch.dueDate ? `将截止日期设为 ${formatDate(patch.dueDate)}` : "清除了截止日期");
      if (patch.estimateHours !== undefined && patch.estimateHours !== before.estimateHours)
        changes.push(patch.estimateHours === null ? "清除了预估工时" : `将预估工时设为 ${patch.estimateHours} 小时`);
      if (patch.milestoneId !== undefined && patch.milestoneId !== before.milestoneId) {
        const m = patch.milestoneId ? await tx.milestone.findUnique({ where: { id: patch.milestoneId } }) : null;
        changes.push(m ? `关联到里程碑「${m.name}」` : "移出了里程碑");
      }
      if (patch.parentId !== undefined && patch.parentId !== before.parentId) changes.push(patch.parentId ? "设置了父任务" : "移除了父任务");
      for (const detail of changes) await audit(tx, { entityType: "task", entityId: id, action: "updated", detail, userId: user.id });

      if (patch.status === "DONE" && before.status !== "DONE" && before.reporterId !== user.id) {
        await notify(tx, {
          userIds: [before.reporterId],
          actorId: user.id,
          type: "task",
          title: `${user.name} 完成了任务「${taskKey(before.project.code, before.no)} ${before.title}」`,
          link: taskLink(before.projectId, id),
        });
      }
    });
    revalidatePms();
  });
}

export async function moveTask(id: string, status: (typeof TASK_STATUSES)[number], sortOrder: number) {
  return runAction("pms:view", async (user) => {
    const s = parseInput(z.enum(TASK_STATUSES), status);
    const order = parseInput(z.number().finite(), sortOrder);
    const t = await db.task.findUnique({ where: { id }, include: { project: true } });
    if (!t) throw new Error("任务不存在");
    await assertEditTasks(user, t.projectId);
    await db.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          status: s,
          sortOrder: order,
          ...(s !== t.status ? { completedAt: s === "DONE" ? new Date() : null } : {}),
        },
      });
      if (s !== t.status) {
        await audit(tx, {
          entityType: "task",
          entityId: id,
          action: "updated",
          detail: `将状态从「${TASK_STATUS[t.status].label}」改为「${TASK_STATUS[s].label}」`,
          userId: user.id,
        });
        if (s === "DONE" && t.reporterId !== user.id) {
          await notify(tx, {
            userIds: [t.reporterId],
            actorId: user.id,
            type: "task",
            title: `${user.name} 完成了任务「${taskKey(t.project.code, t.no)} ${t.title}」`,
            link: taskLink(t.projectId, id),
          });
        }
      }
    });
    revalidatePms();
  });
}

export async function deleteTask(id: string) {
  return runAction("pms:view", async (user) => {
    const t = await db.task.findUnique({ where: { id }, include: { subtasks: { select: { id: true } } } });
    if (!t) throw new Error("任务不存在");
    await assertEditTasks(user, t.projectId);
    await db.$transaction(async (tx) => {
      const ids = [t.id, ...t.subtasks.map((s) => s.id)];
      await tx.comment.deleteMany({ where: { targetType: "task", targetId: { in: ids } } });
      await tx.task.delete({ where: { id } });
      if (t.parentId) await audit(tx, { entityType: "task", entityId: t.parentId, action: "subtask", detail: `删除了子任务「${t.title}」`, userId: user.id });
      await audit(tx, { entityType: "project", entityId: t.projectId, action: "task_deleted", detail: t.title, userId: user.id });
    });
    revalidatePms();
    return { projectId: t.projectId, parentId: t.parentId };
  });
}

// ───────────── 工时 ─────────────

const timeLogSchema = z.object({
  hours: z.coerce.number({ error: "请输入工时" }).positive("工时必须大于 0").max(24, "单次登记不能超过 24 小时"),
  date: z
    .string()
    .nullish()
    .transform((v) => parseDateInput(v ?? null) ?? new Date()),
  note: optStr(500),
});

export async function addTimeLog(taskId: string, input: z.input<typeof timeLogSchema>) {
  return runAction("pms:view", async (user) => {
    const t = await db.task.findUnique({ where: { id: taskId } });
    if (!t) throw new Error("任务不存在");
    await assertEditTasks(user, t.projectId);
    const data = parseInput(timeLogSchema, input);
    await db.$transaction(async (tx) => {
      await tx.timeLog.create({ data: { ...data, taskId, userId: user.id } });
      await audit(tx, { entityType: "task", entityId: taskId, action: "timelog", detail: `登记了 ${data.hours} 小时工时`, userId: user.id });
    });
    revalidatePms();
  });
}

export async function deleteTimeLog(id: string) {
  return runAction("pms:view", async (user) => {
    const log = await db.timeLog.findUnique({ where: { id }, include: { task: true } });
    if (!log) throw new Error("工时记录不存在");
    if (log.userId !== user.id) await assertManageProject(user, log.task.projectId);
    await db.timeLog.delete({ where: { id } });
    revalidatePms();
  });
}

// ───────────── 评论 ─────────────

export async function addTaskComment(taskId: string, content: string) {
  return runAction("pms:view", async (user) => {
    const text = parseInput(z.string().trim().min(1, "请输入评论内容").max(5000, "评论过长"), content);
    const t = await db.task.findUnique({ where: { id: taskId }, include: { project: { include: { members: { include: { user: true } } } } } });
    if (!t) throw new Error("任务不存在");
    await assertEditTasks(user, t.projectId);
    const candidates = await db.user.findMany({ where: { active: true, isBot: false }, select: { id: true, name: true } });
    const mentioned = candidates.filter((u) => text.includes(`@${u.name}`)).map((u) => u.id);
    const key = taskKey(t.project.code, t.no);
    await db.$transaction(async (tx) => {
      await tx.comment.create({ data: { targetType: "task", targetId: taskId, authorId: user.id, content: text } });
      const link = taskLink(t.projectId, t.id);
      await notify(tx, {
        userIds: mentioned,
        actorId: user.id,
        type: "mention",
        title: `${user.name} 在任务「${key} ${t.title}」中提到了你`,
        body: text.slice(0, 200),
        link,
      });
      await notify(tx, {
        userIds: [t.assigneeId, t.reporterId].filter((id) => id && !mentioned.includes(id)),
        actorId: user.id,
        type: "comment",
        title: `${user.name} 评论了任务「${key} ${t.title}」`,
        body: text.slice(0, 200),
        link,
      });
    });
    revalidatePms();
  });
}

export async function deleteTaskComment(id: string) {
  return runAction("pms:view", async (user) => {
    const c = await db.comment.findUnique({ where: { id } });
    if (!c || c.targetType !== "task") throw new Error("评论不存在");
    if (c.authorId !== user.id) {
      const t = await db.task.findUnique({ where: { id: c.targetId } });
      if (!t) throw new Error("任务不存在");
      await assertManageProject(user, t.projectId);
    }
    await db.comment.delete({ where: { id } });
    revalidatePms();
  });
}
