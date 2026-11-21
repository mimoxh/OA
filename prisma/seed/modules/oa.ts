import type { SeedContext } from "../base";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { actOnApproval, startApproval, withdrawApproval } from "@/lib/services/approval";
import { notify } from "@/lib/services/notify";

const DAY = 864e5;

/** 相对今天某天的指定时刻 */
function at(offsetDays: number, hour = 9, minute = 0) {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}
const dateStr = (offsetDays: number) => at(offsetDays).toISOString().slice(0, 10);

/** 处理某审批单当前唯一的待审批任务（或签场景按返回的审批人执行） */
async function actPending(tx: Tx, instanceId: string, action: "APPROVE" | "REJECT", comment?: string) {
  const task = await tx.approvalTask.findFirst({ where: { instanceId, status: "PENDING" } });
  if (!task) throw new Error("没有待审批任务");
  await actOnApproval(tx, { taskId: task.id, userId: task.approverId, action, comment });
}

export async function seedOa(ctx: SeedContext) {
  const { users } = ctx;
  const allIds = Object.values(users).map((u) => u.id);

  // ───────────── 审批实例（各状态） ─────────────

  // 1. 孙浩请假：直属主管（周敏）已同意 → APPROVED
  await db.$transaction(async (tx) => {
    const inst = await startApproval(tx, {
      flowKey: "leave",
      title: "孙浩的请假申请",
      applicantId: users.dev.id,
      formData: { leaveType: "年假", startDate: dateStr(14), endDate: dateStr(16), days: 3, reason: "春节调休回乡探亲" },
    });
    await actPending(tx, inst.id, "APPROVE", "已和主管确认排班，同意");
  });

  // 2. 孙浩费用报销：主管已批，等待财务审核 → PENDING（第二步）
  await db.$transaction(async (tx) => {
    const inst = await startApproval(tx, {
      flowKey: "expense",
      title: "孙浩的费用报销",
      applicantId: users.dev.id,
      formData: { category: "差旅费", amount: 1280, date: dateStr(-5), reason: "客户现场出差住宿与市内交通" },
    });
    await actPending(tx, inst.id, "APPROVE", "属实，同意报销");
  });

  // 3. 张伟费用报销：总经理 + 财务均已通过 → APPROVED（触发自动记账）
  await db.$transaction(async (tx) => {
    const inst = await startApproval(tx, {
      flowKey: "expense",
      title: "张伟的费用报销",
      applicantId: users.admin.id,
      formData: { category: "办公用品", amount: 560, date: dateStr(-3), reason: "采购办公用品一批" },
    });
    await actPending(tx, inst.id, "APPROVE", "同意");
    await actPending(tx, inst.id, "APPROVE", "金额核对无误，准予报销");
  });

  // 4. 赵磊出差申请：销售主管驳回 → REJECTED
  await db.$transaction(async (tx) => {
    const inst = await startApproval(tx, {
      flowKey: "trip",
      title: "赵磊的出差申请",
      applicantId: users.sales2.id,
      formData: { destination: "北京", startDate: dateStr(6), endDate: dateStr(8), budget: 3000, reason: "拜访远航教育洽谈合作项目" },
    });
    await actPending(tx, inst.id, "REJECT", "本月出差预算已满，请下月再申请");
  });

  // 5. 杨帆通用审批：提交后撤回 → WITHDRAWN
  await db.$transaction(async (tx) => {
    const inst = await startApproval(tx, {
      flowKey: "general",
      title: "杨帆的通用审批",
      applicantId: users.dispatch.id,
      formData: { content: "申请更换调度工位办公电脑，现机器频繁死机影响工作" },
    });
    await withdrawApproval(tx, { instanceId: inst.id, userId: users.dispatch.id });
  });

  // 6. 李娜请假：已提交，等待总经理审批 → PENDING
  await db.$transaction(async (tx) => {
    await startApproval(tx, {
      flowKey: "leave",
      title: "李娜的请假申请",
      applicantId: users.sales.id,
      formData: { leaveType: "事假", startDate: dateStr(2), endDate: dateStr(2), days: 1, reason: "家中有事" },
    });
  });

  // ───────────── 公告 ─────────────
  const announcements: { title: string; category: string; pinned?: boolean; content: string; authorId: string; at: Date; readBy?: string[] }[] = [
    {
      title: "关于 2027 年春节放假安排的通知",
      category: "通知",
      pinned: true,
      authorId: users.admin.id,
      at: at(-1),
      content:
        "各位同事：\n\n2027 年春节放假安排如下：2 月 13 日（周六）至 2 月 21 日（周日）放假调休，共 9 天。2 月 22 日（周一）正常上班。\n\n请各部门提前做好工作安排，放假期间值班表稍后另行通知。",
      readBy: [users.pm.id, users.dev.id, users.sales.id, users.finance.id],
    },
    {
      title: "协作平台 2.0 全员内测启动",
      category: "公告",
      pinned: true,
      authorId: users.admin.id,
      at: at(-2),
      content:
        "协作平台 2.0 今日起开放全员内测：\n\n1. 新增文档实时协同编辑，支持多人光标；\n2. 审批、日程、公告入口统一到 OA 工作台；\n3. 全局搜索支持 Ctrl/⌘ + K 唤出。\n\n使用中遇到问题请在「研发部」空间留言或直接联系 IT。",
      readBy: [users.pm.id, users.dev.id],
    },
    {
      title: "第四季度全员会纪要",
      category: "会议纪要",
      authorId: users.ceo.id,
      at: at(-6),
      content:
        "本次会议同步了三件事：\n\n一、Q4 营收目标达成 92%，销售部辛苦了；\n二、明年全面启用新协作平台，OA 审批统一线上化；\n三、春节前完成年度绩效面谈。\n\n相关行动项已录入 PMS 项目「内部效率提升」。",
    },
    {
      title: "信息安全提醒：警惕钓鱼邮件",
      category: "安全",
      authorId: users.admin.id,
      at: at(-9),
      content:
        "近期出现仿冒公司 IT 的钓鱼邮件，请注意：\n\n· IT 不会通过邮件索要密码或验证码；\n· 收到可疑链接请勿点击，转发至 it@demo.com 核实；\n· 重要系统请定期更换密码。",
      readBy: [users.dev.id, users.wh.id, users.dispatch.id, users.driver.id, users.finance.id],
    },
    {
      title: "新员工入职指南（2027 版）",
      category: "人事",
      authorId: users.ceo.id,
      at: at(-15),
      content:
        "欢迎新同事！入职第一周请完成：\n\n1. 到行政处领取工卡与办公设备；\n2. 阅读「公司知识库」中的员工手册；\n3. 由直属主管开通各系统账号；\n4. 参加每周五的新员工分享会。",
    },
  ];
  for (const a of announcements) {
    const ann = await db.announcement.create({
      data: { title: a.title, category: a.category, pinned: !!a.pinned, content: a.content, authorId: a.authorId, publishedAt: a.at },
    });
    if (a.readBy?.length) {
      await db.announcementRead.createMany({ data: a.readBy.map((userId) => ({ announcementId: ann.id, userId, readAt: at(-1, 10) })) });
    }
    // 最近发布的公告通知全体成员
    if (a.at.getTime() >= at(-2).getTime()) {
      await db.$transaction(async (tx) => {
        await notify(tx, { userIds: allIds, actorId: a.authorId, type: "announcement", title: `新公告：${a.title}`, link: `/oa/announcements/${ann.id}` });
      });
    }
  }

  // ───────────── 日程 ─────────────
  const events: {
    title: string;
    start: Date;
    end: Date;
    allDay?: boolean;
    location?: string;
    color: string;
    organizerId: string;
    attendees: { userId: string; status: string }[];
    description?: string;
  }[] = [
    {
      title: "产品研发周会",
      start: at(1, 10),
      end: at(1, 11),
      location: "3F 会议室 A",
      color: "#2383e2",
      organizerId: users.pm.id,
      attendees: [
        { userId: users.dev.id, status: "accepted" },
        { userId: users.admin.id, status: "accepted" },
      ],
      description: "同步 2.0 各模块进度与阻塞项",
    },
    {
      title: "协作平台 2.0 需求评审会",
      start: at(3, 14),
      end: at(3, 16),
      location: "3F 会议室 B",
      color: "#9065b0",
      organizerId: users.pm.id,
      attendees: [
        { userId: users.dev.id, status: "accepted" },
        { userId: users.admin.id, status: "pending" },
        { userId: users.ceo.id, status: "pending" },
      ],
      description: "评审「协作平台 2.0 需求文档」，请提前阅读",
    },
    {
      title: "星辰网络客户回访",
      start: at(5, 9, 30),
      end: at(5, 11, 30),
      location: "客户现场（漕河泾）",
      color: "#0f7b6c",
      organizerId: users.sales.id,
      attendees: [{ userId: users.sales2.id, status: "pending" }],
      description: "确认增购席位方案与实施排期",
    },
    {
      title: "一对一沟通：周敏 × 孙浩",
      start: at(4, 16),
      end: at(4, 16, 30),
      color: "#cb912f",
      organizerId: users.pm.id,
      attendees: [{ userId: users.dev.id, status: "accepted" }],
    },
    {
      title: "月度仓库盘点",
      start: at(6),
      end: at(6, 18),
      allDay: true,
      color: "#448361",
      organizerId: users.wh.id,
      attendees: [
        { userId: users.dispatch.id, status: "accepted" },
        { userId: users.driver.id, status: "declined" },
      ],
      description: "上海中心仓全仓盘点，出入库业务当日暂停",
    },
    {
      title: "全员季度大会",
      start: at(8, 14),
      end: at(8, 16),
      location: "报告厅",
      color: "#d9730d",
      organizerId: users.ceo.id,
      attendees: [
        { userId: users.pm.id, status: "pending" },
        { userId: users.sales.id, status: "pending" },
        { userId: users.finance.id, status: "pending" },
        { userId: users.buyer.id, status: "pending" },
        { userId: users.wh.id, status: "pending" },
      ],
      description: "年度规划宣讲 + 优秀员工表彰",
    },
  ];
  await db.$transaction(async (tx) => {
    for (const e of events) {
      await tx.calendarEvent.create({
        data: {
          title: e.title,
          startAt: e.start,
          endAt: e.end,
          allDay: !!e.allDay,
          location: e.location,
          description: e.description,
          color: e.color,
          organizerId: e.organizerId,
          attendees: { create: e.attendees.map((a) => ({ userId: a.userId, status: a.status })) },
        },
      });
      const organizer = Object.values(users).find((u) => u.id === e.organizerId);
      await notify(tx, {
        userIds: e.attendees.map((a) => a.userId),
        actorId: e.organizerId,
        type: "event",
        title: `${organizer?.name ?? ""} 邀请你参加「${e.title}」`,
        body: e.location ? `地点：${e.location}` : undefined,
        link: "/oa/calendar",
      });
    }
  });
}
