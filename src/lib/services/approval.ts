import type { Tx } from "@/lib/db";
import type { ApprovalInstance } from "@/generated/prisma/client";
import { nextNo } from "@/lib/sequence";
import { audit, notify } from "@/lib/services/notify";
import { approvalHooks } from "@/lib/services/approval-hooks";
import { refreshApprovalCards } from "@/lib/im/cards";

export type ApprovalStep = {
  name: string;
  approverType: "user" | "role" | "manager" | "deptManager";
  approverId?: string;
  roleKey?: string;
  departmentId?: string;
};

export type FormField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "user";
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

export function parseSteps(json: string): ApprovalStep[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function parseFormSchema(json: string): FormField[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const APPROVER_TYPE_LABELS: Record<ApprovalStep["approverType"], string> = {
  user: "指定成员",
  role: "指定角色",
  manager: "申请人直属主管",
  deptManager: "指定部门负责人",
};

async function resolveApprovers(tx: Tx, step: ApprovalStep, applicantId: string): Promise<string[]> {
  let ids: string[] = [];
  if (step.approverType === "user" && step.approverId) {
    ids = [step.approverId];
  } else if (step.approverType === "role" && step.roleKey) {
    const users = await tx.user.findMany({ where: { active: true, isBot: false, role: { key: step.roleKey } }, select: { id: true } });
    ids = users.map((u) => u.id);
  } else if (step.approverType === "manager") {
    const applicant = await tx.user.findUnique({
      where: { id: applicantId },
      include: { department: { include: { parent: true } } },
    });
    const dept = applicant?.department;
    let managerId = dept?.managerId ?? null;
    // 申请人本身是部门负责人时，交由上级部门负责人审批
    if (managerId === applicantId) managerId = dept?.parent?.managerId ?? null;
    if (managerId) ids = [managerId];
  } else if (step.approverType === "deptManager" && step.departmentId) {
    const dept = await tx.department.findUnique({ where: { id: step.departmentId } });
    if (dept?.managerId) ids = [dept.managerId];
  }
  if (!ids.length) {
    const admins = await tx.user.findMany({ where: { active: true, isBot: false, role: { key: "admin" } }, select: { id: true } });
    ids = admins.map((u) => u.id);
  }
  return ids;
}

async function activateStep(tx: Tx, instance: ApprovalInstance, index: number, steps: ApprovalStep[]) {
  const step = steps[index];
  const approvers = await resolveApprovers(tx, step, instance.applicantId);
  await tx.approvalTask.createMany({
    data: approvers.map((approverId) => ({
      instanceId: instance.id,
      step: index,
      stepName: step.name,
      approverId,
    })),
  });
  await tx.approvalInstance.update({ where: { id: instance.id }, data: { currentStep: index } });
  const applicant = await tx.user.findUnique({ where: { id: instance.applicantId } });
  await notify(tx, {
    userIds: approvers,
    actorId: instance.applicantId,
    includeActor: true,
    type: "approval",
    title: `${applicant?.name ?? ""} 提交的「${instance.title}」待你审批`,
    body: `审批节点：${step.name}`,
    link: `/oa/approvals/${instance.id}`,
  });
}

function hookKey(instance: ApprovalInstance & { flow: { key: string } }) {
  return instance.bizType ?? instance.flow.key;
}

async function finalize(tx: Tx, instanceId: string, status: "APPROVED" | "REJECTED" | "WITHDRAWN", userId: string) {
  const instance = await tx.approvalInstance.update({
    where: { id: instanceId },
    data: { status, finishedAt: new Date() },
    include: { flow: true },
  });
  await tx.approvalTask.updateMany({
    where: { instanceId, status: "PENDING" },
    data: { status: "SKIPPED" },
  });
  const hooks = approvalHooks[hookKey(instance)];
  if (status === "APPROVED") await hooks?.onApproved?.(tx, instance, userId);
  if (status === "REJECTED") await hooks?.onRejected?.(tx, instance, userId);
  if (status === "WITHDRAWN") await hooks?.onWithdrawn?.(tx, instance, userId);
  if (status !== "WITHDRAWN") {
    await notify(tx, {
      userIds: [instance.applicantId],
      actorId: userId,
      type: "approval",
      title: `你的「${instance.title}」已${status === "APPROVED" ? "审批通过" : "被驳回"}`,
      link: `/oa/approvals/${instance.id}`,
    });
  }
  return instance;
}

/** 发起审批。必须在事务内调用。 */
export async function startApproval(
  tx: Tx,
  input: {
    flowKey: string;
    title: string;
    applicantId: string;
    formData?: Record<string, unknown>;
    bizType?: string;
    bizId?: string;
  },
) {
  const flow = await tx.approvalFlow.findUnique({ where: { key: input.flowKey } });
  if (!flow || !flow.enabled) throw new Error("审批流程不存在或已停用");
  const steps = parseSteps(flow.steps);
  const instance = await tx.approvalInstance.create({
    data: {
      no: await nextNo(tx, "SP"),
      flowId: flow.id,
      title: input.title,
      applicantId: input.applicantId,
      formData: JSON.stringify(input.formData ?? {}),
      bizType: input.bizType ?? null,
      bizId: input.bizId ?? null,
    },
  });
  await audit(tx, { entityType: "approval", entityId: instance.id, action: "submit", userId: input.applicantId });
  if (steps.length === 0) {
    const done = await finalize(tx, instance.id, "APPROVED", input.applicantId);
    await refreshApprovalCards(tx, instance.id);
    return done;
  }
  await activateStep(tx, instance, 0, steps);
  await refreshApprovalCards(tx, instance.id);
  return instance;
}

/** 审批人处理任务：通过 / 驳回。同一节点多个审批人时为或签（任一人处理即完成该节点）。 */
export async function actOnApproval(
  tx: Tx,
  input: { taskId: string; userId: string; action: "APPROVE" | "REJECT"; comment?: string },
) {
  const task = await tx.approvalTask.findUnique({
    where: { id: input.taskId },
    include: { instance: { include: { flow: true } } },
  });
  if (!task) throw new Error("审批任务不存在");
  if (task.approverId !== input.userId) throw new Error("你不是该任务的审批人");
  if (task.status !== "PENDING") throw new Error("该任务已处理");
  if (task.instance.status !== "PENDING") throw new Error("审批单已结束");
  if (input.action === "REJECT" && !input.comment?.trim()) throw new Error("驳回时请填写意见");

  await tx.approvalTask.update({
    where: { id: task.id },
    data: {
      status: input.action === "APPROVE" ? "APPROVED" : "REJECTED",
      comment: input.comment?.trim() || null,
      actedAt: new Date(),
    },
  });
  await tx.approvalTask.updateMany({
    where: { instanceId: task.instanceId, step: task.step, status: "PENDING" },
    data: { status: "SKIPPED" },
  });
  await audit(tx, {
    entityType: "approval",
    entityId: task.instanceId,
    action: input.action === "APPROVE" ? "approve" : "reject",
    detail: input.comment,
    userId: input.userId,
  });

  if (input.action === "REJECT") {
    const rejected = await finalize(tx, task.instanceId, "REJECTED", input.userId);
    await refreshApprovalCards(tx, task.instanceId);
    return rejected;
  }
  const steps = parseSteps(task.instance.flow.steps);
  const next = task.step + 1;
  if (next < steps.length) {
    await activateStep(tx, task.instance, next, steps);
    const updated = await tx.approvalInstance.findUniqueOrThrow({ where: { id: task.instanceId } });
    await refreshApprovalCards(tx, task.instanceId);
    return updated;
  }
  const approved = await finalize(tx, task.instanceId, "APPROVED", input.userId);
  await refreshApprovalCards(tx, task.instanceId);
  return approved;
}

/** 申请人撤回审批 */
export async function withdrawApproval(tx: Tx, input: { instanceId: string; userId: string }) {
  const instance = await tx.approvalInstance.findUnique({ where: { id: input.instanceId } });
  if (!instance) throw new Error("审批单不存在");
  if (instance.applicantId !== input.userId) throw new Error("只有申请人可以撤回");
  if (instance.status !== "PENDING") throw new Error("审批单已结束，无法撤回");
  await audit(tx, { entityType: "approval", entityId: instance.id, action: "withdraw", userId: input.userId });
  const withdrawn = await finalize(tx, instance.id, "WITHDRAWN", input.userId);
  await refreshApprovalCards(tx, instance.id);
  return withdrawn;
}
