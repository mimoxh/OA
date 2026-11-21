import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/dal";
import { APPROVER_TYPE_LABELS, parseFormSchema, type ApprovalStep } from "@/lib/services/approval";
import { parseFormData } from "@/lib/oa/form";
import type { MemberOption } from "@/lib/oa/types";

export async function getMemberOptions(opts: { includeInactive?: boolean } = {}): Promise<MemberOption[]> {
  const users = await db.user.findMany({
    where: opts.includeInactive ? {} : { active: true },
    select: { id: true, name: true, avatarColor: true, title: true, department: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name, avatarColor: u.avatarColor, title: u.title, department: u.department?.name ?? null }));
}

export type ApprovalTab = "todo" | "done" | "mine" | "all";

export function approvalTabWhere(tab: ApprovalTab, userId: string): Prisma.ApprovalInstanceWhereInput {
  switch (tab) {
    case "todo":
      return { status: "PENDING", tasks: { some: { approverId: userId, status: "PENDING" } } };
    case "done":
      return { tasks: { some: { approverId: userId, status: { in: ["APPROVED", "REJECTED"] } } } };
    case "mine":
      return { applicantId: userId };
    default:
      return {};
  }
}

export function canSeeAllApprovals(user: CurrentUser) {
  return can(user, "oa:edit") || can(user, "admin");
}

/** 申请人、审批人、表单中被引用的成员（如知会人）以及 OA 管理员可以查看审批单 */
export function canViewApproval(
  user: CurrentUser,
  instance: { applicantId: string; formData: string; tasks: { approverId: string }[]; flow: { formSchema: string } },
) {
  if (canSeeAllApprovals(user)) return true;
  if (instance.applicantId === user.id) return true;
  if (instance.tasks.some((t) => t.approverId === user.id)) return true;
  const data = parseFormData(instance.formData);
  return parseFormSchema(instance.flow.formSchema).some((f) => f.type === "user" && data[f.name] === user.id);
}

export type StepPreview = {
  name: string;
  typeLabel: string;
  detail: string;
  approvers: { id: string; name: string; avatarColor: string }[];
  fallback: boolean;
};

const userSelect = { id: true, name: true, avatarColor: true } as const;

/** 以某个申请人的视角预览审批节点的实际审批人（逻辑与审批引擎 resolveApprovers 一致） */
export async function previewSteps(steps: ApprovalStep[], applicantId: string): Promise<StepPreview[]> {
  const applicant = await db.user.findUnique({
    where: { id: applicantId },
    include: { department: { include: { parent: true } } },
  });
  const out: StepPreview[] = [];
  for (const step of steps) {
    let approvers: StepPreview["approvers"] = [];
    let detail = APPROVER_TYPE_LABELS[step.approverType] ?? step.approverType;
    if (step.approverType === "user" && step.approverId) {
      const u = await db.user.findFirst({ where: { id: step.approverId, active: true }, select: userSelect });
      if (u) approvers = [u];
      detail = `指定成员：${u?.name ?? "（成员不存在）"}`;
    } else if (step.approverType === "role" && step.roleKey) {
      const role = await db.role.findUnique({ where: { key: step.roleKey } });
      approvers = await db.user.findMany({ where: { active: true, role: { key: step.roleKey } }, select: userSelect });
      detail = `角色「${role?.name ?? step.roleKey}」${approvers.length > 1 ? "（或签，任一人处理即可）" : ""}`;
    } else if (step.approverType === "manager") {
      const dept = applicant?.department;
      let managerId = dept?.managerId ?? null;
      if (managerId === applicantId) managerId = dept?.parent?.managerId ?? null;
      if (managerId) {
        const u = await db.user.findUnique({ where: { id: managerId }, select: userSelect });
        if (u) approvers = [u];
      }
      detail = "申请人直属主管";
    } else if (step.approverType === "deptManager" && step.departmentId) {
      const dept = await db.department.findUnique({ where: { id: step.departmentId }, include: { manager: { select: userSelect } } });
      if (dept?.manager) approvers = [dept.manager];
      detail = `「${dept?.name ?? "未知部门"}」负责人`;
    }
    let fallback = false;
    if (!approvers.length) {
      fallback = true;
      approvers = await db.user.findMany({ where: { active: true, role: { key: "admin" } }, select: userSelect });
    }
    out.push({ name: step.name, typeLabel: APPROVER_TYPE_LABELS[step.approverType], detail, approvers, fallback });
  }
  return out;
}
