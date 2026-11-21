"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { audit } from "@/lib/services/notify";
import type { ApprovalStep, FormField } from "@/lib/services/approval";
import { parseInput } from "@/lib/oa/validate";

const fieldSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, "字段标识只能包含字母、数字和下划线，且不能以数字开头"),
  label: z.string().trim().min(1, "字段名称不能为空").max(30, "字段名称不能超过 30 字"),
  type: z.enum(["text", "textarea", "number", "date", "select", "user"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().max(60, "占位提示不能超过 60 字").optional(),
});

const stepSchema = z.object({
  name: z.string().trim().min(1, "审批节点名称不能为空").max(30, "节点名称不能超过 30 字"),
  approverType: z.enum(["user", "role", "manager", "deptManager"]),
  approverId: z.string().optional(),
  roleKey: z.string().optional(),
  departmentId: z.string().optional(),
});

const flowSchema = z.object({
  id: z.string().optional(),
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, "流程标识需以小写字母开头，只能包含小写字母、数字和下划线（2-40 位）"),
  name: z.string().trim().min(1, "请填写流程名称").max(30, "流程名称不能超过 30 字"),
  category: z.string().trim().min(1, "请填写分类").max(20, "分类不能超过 20 字"),
  icon: z.string().trim().min(1, "请填写图标").max(16, "图标请使用一个 emoji"),
  description: z.string().trim().max(200, "描述不能超过 200 字").optional(),
  formSchema: z.array(fieldSchema).max(30, "表单字段不能超过 30 个"),
  steps: z.array(stepSchema).min(1, "至少需要一个审批节点").max(10, "审批节点不能超过 10 个"),
});

export type FlowInput = z.input<typeof flowSchema>;

async function normalizeSteps(steps: z.output<typeof stepSchema>[]): Promise<ApprovalStep[]> {
  const out: ApprovalStep[] = [];
  for (const [i, s] of steps.entries()) {
    const label = `第 ${i + 1} 个审批节点「${s.name}」`;
    if (s.approverType === "user") {
      if (!s.approverId) throw new Error(`${label}请选择审批成员`);
      const u = await db.user.findUnique({ where: { id: s.approverId } });
      if (!u) throw new Error(`${label}的审批成员不存在`);
      out.push({ name: s.name, approverType: "user", approverId: s.approverId });
    } else if (s.approverType === "role") {
      if (!s.roleKey) throw new Error(`${label}请选择审批角色`);
      const r = await db.role.findUnique({ where: { key: s.roleKey } });
      if (!r) throw new Error(`${label}的审批角色不存在`);
      out.push({ name: s.name, approverType: "role", roleKey: s.roleKey });
    } else if (s.approverType === "deptManager") {
      if (!s.departmentId) throw new Error(`${label}请选择部门`);
      const d = await db.department.findUnique({ where: { id: s.departmentId } });
      if (!d) throw new Error(`${label}的部门不存在`);
      out.push({ name: s.name, approverType: "deptManager", departmentId: s.departmentId });
    } else {
      out.push({ name: s.name, approverType: "manager" });
    }
  }
  return out;
}

function normalizeFields(fields: z.output<typeof fieldSchema>[]): FormField[] {
  const names = new Set<string>();
  return fields.map((f) => {
    if (names.has(f.name)) throw new Error(`字段标识「${f.name}」重复`);
    names.add(f.name);
    const field: FormField = { name: f.name, label: f.label, type: f.type };
    if (f.required) field.required = true;
    if (f.placeholder?.trim()) field.placeholder = f.placeholder.trim();
    if (f.type === "select") {
      const options = [...new Set((f.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (!options.length) throw new Error(`单选字段「${f.label}」至少需要一个选项`);
      field.options = options;
    }
    return field;
  });
}

export async function saveFlow(input: FlowInput) {
  return runAction("oa:edit", async (user) => {
    const v = parseInput(flowSchema, input);
    const steps = JSON.stringify(await normalizeSteps(v.steps));
    if (v.id) {
      const flow = await db.approvalFlow.findUnique({ where: { id: v.id } });
      if (!flow) throw new Error("流程不存在");
      if (flow.system) {
        await db.approvalFlow.update({ where: { id: flow.id }, data: { steps } });
      } else {
        await db.approvalFlow.update({
          where: { id: flow.id },
          data: {
            name: v.name,
            category: v.category,
            icon: v.icon,
            description: v.description || null,
            formSchema: JSON.stringify(normalizeFields(v.formSchema)),
            steps,
          },
        });
      }
      await audit(db, { entityType: "approval_flow", entityId: flow.id, action: "update", userId: user.id });
      revalidatePath("/oa/flows");
      return { id: flow.id };
    }
    const exists = await db.approvalFlow.findUnique({ where: { key: v.key } });
    if (exists) throw new Error(`流程标识「${v.key}」已被使用`);
    const flow = await db.approvalFlow.create({
      data: {
        key: v.key,
        name: v.name,
        category: v.category,
        icon: v.icon,
        description: v.description || null,
        formSchema: JSON.stringify(normalizeFields(v.formSchema)),
        steps,
      },
    });
    await audit(db, { entityType: "approval_flow", entityId: flow.id, action: "create", userId: user.id });
    revalidatePath("/oa/flows");
    return { id: flow.id };
  });
}

export async function setFlowEnabled(id: string, enabled: boolean) {
  return runAction("oa:edit", async (user) => {
    const flowId = parseInput(z.string().min(1), id);
    await db.approvalFlow.update({ where: { id: flowId }, data: { enabled: !!enabled } });
    await audit(db, { entityType: "approval_flow", entityId: flowId, action: enabled ? "enable" : "disable", userId: user.id });
    revalidatePath("/oa/flows");
  });
}

export async function deleteFlow(id: string) {
  return runAction("oa:edit", async (user) => {
    const flow = await db.approvalFlow.findUnique({ where: { id: parseInput(z.string().min(1), id) }, include: { _count: { select: { instances: true } } } });
    if (!flow) throw new Error("流程不存在");
    if (flow.system) throw new Error("业务单据专用流程不能删除");
    if (flow._count.instances > 0) throw new Error(`该流程已有 ${flow._count.instances} 条审批记录，无法删除，可以将其停用`);
    await db.approvalFlow.delete({ where: { id: flow.id } });
    await audit(db, { entityType: "approval_flow", entityId: flow.id, action: "delete", userId: user.id });
    revalidatePath("/oa/flows");
  });
}
