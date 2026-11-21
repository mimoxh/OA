"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { actOnApproval, parseFormSchema, startApproval, withdrawApproval } from "@/lib/services/approval";
import { notify } from "@/lib/services/notify";
import { validateFormData } from "@/lib/oa/form";
import { canViewApproval } from "@/lib/oa/server";
import { parseInput } from "@/lib/oa/validate";

const submitSchema = z.object({
  flowKey: z.string().min(1),
  title: z.string().trim().min(1, "请填写审批标题").max(100, "标题不能超过 100 字"),
  formData: z.record(z.string(), z.unknown()),
});

export async function submitApproval(input: z.input<typeof submitSchema>) {
  return runAction("oa:view", async (user) => {
    const v = parseInput(submitSchema, input);
    const flow = await db.approvalFlow.findUnique({ where: { key: v.flowKey } });
    if (!flow || !flow.enabled) throw new Error("审批流程不存在或已停用");
    if (flow.system) throw new Error("该流程由业务单据自动发起，不能手动提交");
    const fields = parseFormSchema(flow.formSchema);
    const { data, errors } = validateFormData(fields, v.formData);
    const firstError = Object.values(errors)[0];
    if (firstError) throw new Error(firstError);
    const userIds = fields.filter((f) => f.type === "user" && data[f.name]).map((f) => String(data[f.name]));
    if (userIds.length) {
      const n = await db.user.count({ where: { id: { in: userIds } } });
      if (n !== new Set(userIds).size) throw new Error("所选成员不存在");
    }
    const instance = await db.$transaction((tx) =>
      startApproval(tx, { flowKey: flow.key, title: v.title, applicantId: user.id, formData: data }),
    );
    revalidatePath("/oa");
    revalidatePath("/oa/approvals");
    return { id: instance.id };
  });
}

const actSchema = z.object({
  instanceId: z.string().min(1),
  action: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().max(1000, "意见不能超过 1000 字").optional(),
});

export async function decideApproval(input: z.input<typeof actSchema>) {
  return runAction("oa:view", async (user) => {
    const v = parseInput(actSchema, input);
    if (v.action === "REJECT" && !v.comment?.trim()) throw new Error("驳回时请填写意见");
    const task = await db.approvalTask.findFirst({
      where: { instanceId: v.instanceId, approverId: user.id, status: "PENDING" },
    });
    if (!task) throw new Error("你没有待处理的审批任务，可能已被其他审批人处理");
    const instance = await db.$transaction((tx) =>
      actOnApproval(tx, { taskId: task.id, userId: user.id, action: v.action, comment: v.comment }),
    );
    revalidatePath(`/oa/approvals/${v.instanceId}`);
    revalidatePath("/oa/approvals");
    if (instance.bizType === "purchase_order" && instance.bizId) revalidatePath(`/erp/purchase/${instance.bizId}`);
    return { status: instance.status };
  });
}

export async function withdrawMyApproval(instanceId: string) {
  return runAction("oa:view", async (user) => {
    const id = parseInput(z.string().min(1), instanceId);
    const instance = await db.$transaction((tx) => withdrawApproval(tx, { instanceId: id, userId: user.id }));
    revalidatePath(`/oa/approvals/${id}`);
    revalidatePath("/oa/approvals");
    if (instance.bizType === "purchase_order" && instance.bizId) revalidatePath(`/erp/purchase/${instance.bizId}`);
  });
}

const commentSchema = z.object({
  instanceId: z.string().min(1),
  content: z.string().trim().min(1, "评论不能为空").max(2000, "评论不能超过 2000 字"),
});

export async function addApprovalComment(input: z.input<typeof commentSchema>) {
  return runAction("oa:view", async (user) => {
    const v = parseInput(commentSchema, input);
    const instance = await db.approvalInstance.findUnique({
      where: { id: v.instanceId },
      include: { tasks: { select: { approverId: true } }, flow: { select: { formSchema: true } } },
    });
    if (!instance || !canViewApproval(user, instance)) throw new Error("审批单不存在或无权访问");
    await db.$transaction(async (tx) => {
      await tx.comment.create({
        data: { targetType: "approval", targetId: instance.id, authorId: user.id, content: v.content },
      });
      await notify(tx, {
        userIds: [instance.applicantId, ...instance.tasks.map((t) => t.approverId)],
        actorId: user.id,
        type: "comment",
        title: `${user.name} 评论了审批「${instance.title}」`,
        body: v.content.slice(0, 120),
        link: `/oa/approvals/${instance.id}`,
      });
    });
    revalidatePath(`/oa/approvals/${instance.id}`);
  });
}

export async function deleteApprovalComment(commentId: string) {
  return runAction("oa:view", async (user) => {
    const c = await db.comment.findUnique({ where: { id: parseInput(z.string().min(1), commentId) } });
    if (!c || c.targetType !== "approval") throw new Error("评论不存在");
    if (c.authorId !== user.id && !user.permissions.includes("admin")) throw new Error("只能删除自己的评论");
    await db.comment.delete({ where: { id: c.id } });
    revalidatePath(`/oa/approvals/${c.targetId}`);
  });
}
