import type { SeedContext } from "../base";
import { db } from "@/lib/db";
import { b, extractText } from "@/lib/docs/content";
import { nextCode } from "@/lib/sequence";

const DAY = 864e5;
const at = (offsetDays: number, hour = 18) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

type UserKey = keyof SeedContext["users"];
type Status = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

type TaskDef = {
  title: string;
  status: Status;
  priority?: Priority;
  assignee?: UserKey;
  /** 相对今天的天数偏移 */
  start?: number;
  due?: number;
  /** 预估工时 */
  est?: number;
  /** 关联里程碑下标 */
  ms?: number;
  desc?: string;
  /** 已完成任务的完成时间偏移（默认完成于 1 天前） */
  doneAt?: number;
  subs?: { title: string; status: Status; assignee?: UserKey }[];
  logs?: [user: UserKey, hours: number, dateOffset: number, note?: string][];
  comments?: [user: UserKey, content: string][];
};

async function seedProject(
  ctx: SeedContext,
  input: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    status: "PLANNING" | "ACTIVE";
    owner: UserKey;
    customerIdx?: number;
    start?: number;
    end?: number;
    budget?: number;
    members: [user: UserKey, role: string][];
    milestones: { name: string; due: number; done?: boolean; description?: string }[];
    tasks: TaskDef[];
    documentId?: string;
  },
) {
  const { users, customers } = ctx;
  await db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        code: await nextCode(tx, "PRJ"),
        name: input.name,
        description: input.description,
        icon: input.icon ?? "🚀",
        color: input.color ?? "#2383e2",
        status: input.status,
        ownerId: users[input.owner].id,
        customerId: input.customerIdx !== undefined ? customers[input.customerIdx]?.id : undefined,
        documentId: input.documentId,
        startDate: input.start !== undefined ? at(input.start, 9) : undefined,
        endDate: input.end !== undefined ? at(input.end, 9) : undefined,
        budget: input.budget ?? 0,
        members: { create: input.members.map(([u, role]) => ({ userId: users[u].id, role })) },
      },
    });
    const msIds: string[] = [];
    for (const m of input.milestones) {
      const ms = await tx.milestone.create({
        data: {
          projectId: project.id,
          name: m.name,
          description: m.description,
          dueDate: at(m.due, 9),
          status: m.done ? "DONE" : "OPEN",
        },
      });
      msIds.push(ms.id);
    }

    let no = 0;
    for (const [i, t] of input.tasks.entries()) {
      const task = await tx.task.create({
        data: {
          no: ++no,
          projectId: project.id,
          milestoneId: t.ms !== undefined ? msIds[t.ms] : undefined,
          title: t.title,
          description: t.desc,
          status: t.status,
          priority: t.priority ?? "MEDIUM",
          assigneeId: t.assignee ? users[t.assignee].id : undefined,
          reporterId: users[input.owner].id,
          startDate: t.start !== undefined ? at(t.start, 9) : undefined,
          dueDate: t.due !== undefined ? at(t.due, 18) : undefined,
          estimateHours: t.est,
          sortOrder: i,
          completedAt: t.status === "DONE" ? at(t.doneAt ?? -1, 17) : undefined,
        },
      });
      for (const [j, s] of (t.subs ?? []).entries()) {
        await tx.task.create({
          data: {
            no: ++no,
            projectId: project.id,
            parentId: task.id,
            title: s.title,
            status: s.status,
            priority: t.priority ?? "MEDIUM",
            assigneeId: (s.assignee ?? t.assignee) ? users[(s.assignee ?? t.assignee)!].id : undefined,
            reporterId: users[input.owner].id,
            sortOrder: j,
            completedAt: s.status === "DONE" ? at(-1, 17) : undefined,
          },
        });
      }
      for (const [u, hours, dayOff, note] of t.logs ?? []) {
        await tx.timeLog.create({
          data: { taskId: task.id, userId: users[u].id, hours, date: at(dayOff, 17), note },
        });
      }
      for (const [u, content] of t.comments ?? []) {
        await tx.comment.create({
          data: { targetType: "task", targetId: task.id, authorId: users[u].id, content },
        });
      }
    }
  });
}

export async function seedPms(ctx: SeedContext) {
  const { users, spaces } = ctx;

  // 项目 1 关联的项目文档
  const projDoc = await db.document.create({
    data: {
      spaceId: spaces.rd.id,
      title: "协作平台 2.0 项目文档",
      icon: "🚀",
      content: JSON.stringify(
        b.doc(
          b.callout("📌", "本页是「协作平台 2.0 开发」项目的关联文档，项目看板见 PMS 模块。"),
          b.h(2, "项目目标"),
          b.p("完成 2.0 版本三个方向：离线协同编辑、移动端审批、开放 API。"),
          b.h(2, "周会纪要入口"),
          b.p("每周产品研发周会的纪要子页面存放在本页面下。"),
        ),
      ),
      text: extractText(
        b.doc(
          b.callout("📌", "本页是「协作平台 2.0 开发」项目的关联文档，项目看板见 PMS 模块。"),
          b.h(2, "项目目标"),
          b.p("完成 2.0 版本三个方向：离线协同编辑、移动端审批、开放 API。"),
          b.h(2, "周会纪要入口"),
          b.p("每周产品研发周会的纪要子页面存放在本页面下。"),
        ),
      ),
      sortOrder: 3,
      createdById: users.pm.id,
      updatedById: users.pm.id,
    },
  });

  // ───────────── 项目 1：协作平台 2.0 开发 ─────────────
  await seedProject(ctx, {
    name: "协作平台 2.0 开发",
    description: "离线协同编辑、移动端审批与开放 API 三大方向",
    icon: "🚀",
    color: "#2383e2",
    status: "ACTIVE",
    owner: "pm",
    start: -45,
    end: 45,
    budget: 800000,
    documentId: projDoc.id,
    members: [
      ["pm", "owner"],
      ["dev", "member"],
      ["admin", "member"],
      ["ceo", "viewer"],
    ],
    milestones: [
      { name: "需求冻结", due: -5, done: true, description: "PRD 评审通过，功能范围锁定" },
      { name: "MVP 联调完成", due: 12, description: "三大方向功能联调通过" },
      { name: "正式上线", due: 32, description: "灰度 → 全量发布" },
    ],
    tasks: [
      { title: "需求文档定稿", status: "DONE", priority: "HIGH", assignee: "pm", ms: 0, due: -12, doneAt: -13, est: 8, logs: [["pm", 4, -14, "初稿"], ["pm", 4, -13, "评审修订"]] },
      { title: "协同服务技术选型", status: "DONE", priority: "HIGH", assignee: "dev", ms: 0, due: -20, doneAt: -18, desc: "Yjs + Hocuspocus 方案对比与验证", logs: [["dev", 6, -19, "POC 验证"]] },
      { title: "数据库 schema 评审", status: "DONE", assignee: "admin", ms: 0, due: -10, doneAt: -9, est: 4 },
      { title: "UI 设计走查（第一期）", status: "DONE", assignee: "pm", due: -7, doneAt: -6, est: 3 },
      {
        title: "离线编辑冲突合并",
        status: "IN_PROGRESS",
        priority: "URGENT",
        assignee: "dev",
        ms: 1,
        start: -8,
        due: 5,
        est: 24,
        desc: "基于 Yjs 的离线编辑与自动冲突合并，覆盖断网场景",
        subs: [
          { title: "CRDT 方案验证", status: "DONE", assignee: "dev" },
          { title: "断线重连状态恢复", status: "IN_PROGRESS", assignee: "dev" },
        ],
        logs: [["dev", 7, -3, "合并算法"], ["dev", 6, -2, "边界 case"], ["dev", 3, -1]],
        comments: [
          ["pm", "进度如何？评审会前需要能演示核心流程"],
          ["dev", "重连恢复还剩边界 case，预计后天可演示"],
        ],
      },
      { title: "审批移动端适配", status: "IN_PROGRESS", priority: "HIGH", assignee: "dev", ms: 1, start: -3, due: 8, est: 16, logs: [["dev", 5, -1, "表单控件适配"]] },
      { title: "协同光标渲染优化", status: "IN_PROGRESS", assignee: "dev", due: 6, est: 8 },
      { title: "API 网关限流", status: "IN_PROGRESS", priority: "LOW", assignee: "admin", due: 15, est: 12 },
      { title: "文档搜索性能优化", status: "REVIEW", assignee: "dev", due: -1, doneAt: -2, est: 10, desc: "中文分词与索引重建", comments: [["admin", "搜索响应已降到 300ms 内，待复测"]] },
      { title: "审批流程引擎重构", status: "REVIEW", priority: "HIGH", assignee: "pm", due: 2, est: 12 },
      { title: "通知中心联调", status: "REVIEW", assignee: "admin", due: 3, est: 6 },
      { title: "旧版文档迁移脚本", status: "REVIEW", priority: "HIGH", assignee: "dev", due: -1, est: 8, comments: [["pm", "逾期一天了，今天能收尾吗"]] },
      { title: "开放 API 文档编写", status: "TODO", assignee: "pm", ms: 2, start: 5, due: 20, est: 10 },
      { title: "灰度发布方案", status: "TODO", priority: "HIGH", assignee: "admin", ms: 2, start: 15, due: 25, est: 6 },
      { title: "移动端截图走查", status: "TODO", assignee: "pm", due: 18, est: 4 },
      { title: "NPS 调研问卷设计", status: "TODO", priority: "LOW", assignee: "pm", due: 30, est: 3 },
      { title: "压力测试报告", status: "TODO", assignee: "dev", ms: 2, start: 10, due: 22, est: 8 },
      { title: "旧版导入工具兼容", status: "TODO", assignee: "dev", due: -3, est: 6, desc: "逾期：导入旧版 docx 格式丢失问题" },
      { title: "客服知识库对接", status: "TODO", priority: "LOW", due: 35, est: 5 },
    ],
  });

  // ───────────── 项目 2：上海星辰网络 OA 实施 ─────────────
  await seedProject(ctx, {
    name: "上海星辰网络 OA 实施",
    description: "星辰网络 200 席 OA + 文档协同实施交付",
    icon: "🏢",
    color: "#0f7b6c",
    status: "ACTIVE",
    owner: "sales",
    customerIdx: 0,
    start: -30,
    end: 30,
    budget: 360000,
    members: [
      ["sales", "owner"],
      ["sales2", "member"],
      ["pm", "member"],
    ],
    milestones: [
      { name: "需求调研完成", due: -10, done: true },
      { name: "系统配置完成", due: 7 },
      { name: "上线交付", due: 25 },
    ],
    tasks: [
      { title: "需求调研报告", status: "DONE", priority: "HIGH", assignee: "sales", ms: 0, due: -12, doneAt: -11, est: 12, logs: [["sales", 6, -12, "现场调研"], ["sales", 4, -11, "报告撰写"]] },
      { title: "组织架构与人员导入", status: "DONE", assignee: "sales2", ms: 0, due: -5, doneAt: -4, est: 6 },
      { title: "审批流程配置（10 条）", status: "IN_PROGRESS", priority: "HIGH", assignee: "pm", ms: 1, start: -4, due: 4, est: 16, desc: "按调研报告的流程清单配置，含请假/报销/采购", logs: [["pm", 5, -2, "前 6 条"], ["pm", 3, -1]], comments: [["sales", "客户催进度了，本周五前需要完成配置"]] },
      { title: "权限角色配置", status: "IN_PROGRESS", assignee: "pm", ms: 1, due: 5, est: 6 },
      { title: "文档空间规划与创建", status: "IN_PROGRESS", assignee: "sales2", due: 6, est: 4 },
      { title: "历史数据迁移", status: "REVIEW", priority: "HIGH", assignee: "sales2", due: -2, est: 10, comments: [["sales", "客户旧系统数据字典已拿到，注意编码转换"]] },
      { title: "UAT 用例编写", status: "TODO", assignee: "pm", ms: 1, start: 3, due: 9, est: 8 },
      { title: "管理员培训材料", status: "TODO", assignee: "sales2", ms: 2, start: 8, due: 15, est: 6 },
      { title: "用户培训（两场）", status: "TODO", assignee: "sales", ms: 2, start: 16, due: 20, est: 8 },
      { title: "上线检查清单", status: "TODO", priority: "HIGH", assignee: "pm", ms: 2, due: 22, est: 3 },
      { title: "客户验收签字", status: "TODO", priority: "URGENT", assignee: "sales", ms: 2, due: 25, est: 2 },
      { title: "首月运维保障方案", status: "TODO", priority: "LOW", due: 28, est: 4 },
    ],
  });
}
