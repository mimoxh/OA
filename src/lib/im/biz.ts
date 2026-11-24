import { format } from "date-fns";
import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { CUSTOMER_STATUS, OPPORTUNITY_STAGE, PROJECT_STATUS } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import { queueEvent } from "@/lib/realtime/buffer";
import { BIZ_META } from "./biz-meta";
import { conversationUserIds } from "./queries";
import { appendMessage } from "./service";
import type { BizType, Card } from "./types";

type Actor = { id: string; name: string; permissions: string[] };

function formatEventTime(start: Date, end: Date, allDay: boolean) {
  if (allDay) {
    const s = format(start, "M月d日");
    const e = format(end, "M月d日");
    return s === e ? `${s} 全天` : `${s} - ${e} 全天`;
  }
  const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
  return `${format(start, "M月d日 HH:mm")} - ${format(end, sameDay ? "HH:mm" : "M月d日 HH:mm")}`;
}

export function bizDirectKey(bizType: BizType, bizId: string) {
  return `biz:${bizType}:${bizId}`;
}

type BizDescriptor = {
  name: string;
  ownerId: string;
  memberIds: string[];
  card: Card;
};

async function loadBizDescriptor(client: DbClient, actor: Actor, bizType: BizType, bizId: string): Promise<BizDescriptor> {
  switch (bizType) {
    case "project": {
      if (!hasPermission(actor.permissions, "pms:view")) throw new Error("你没有权限访问该项目");
      const p = await client.project.findUnique({
        where: { id: bizId },
        include: {
          owner: { select: { id: true, name: true, avatarColor: true } },
          customer: { select: { name: true } },
          members: { select: { userId: true } },
        },
      });
      if (!p) throw new Error("项目不存在");
      const memberIds = [...new Set([p.ownerId, ...p.members.map((m) => m.userId), actor.id])];
      const st = PROJECT_STATUS[p.status];
      return {
        name: `项目 · ${p.name}`.slice(0, 40),
        ownerId: p.ownerId,
        memberIds,
        card: {
          template: "generic",
          title: `${p.icon} ${p.name}`,
          body: p.description ?? null,
          link: `/pms/projects/${p.id}`,
          actor: p.owner,
          ref: { type: "project", id: p.id },
          status: st ? { label: st.label, color: st.color === "green" || st.color === "red" || st.color === "blue" ? st.color : st.color === "orange" || st.color === "yellow" ? "orange" : "gray" } : null,
          fields: [
            { label: "负责人", value: p.owner.name },
            ...(p.customer ? [{ label: "关联客户", value: p.customer.name }] : []),
          ],
        },
      };
    }
    case "customer": {
      if (!hasPermission(actor.permissions, "crm:view")) throw new Error("你没有权限访问该客户");
      const c = await client.customer.findUnique({
        where: { id: bizId },
        include: {
          owner: { select: { id: true, name: true, avatarColor: true } },
          opportunities: { select: { ownerId: true } },
        },
      });
      if (!c) throw new Error("客户不存在");
      const memberIds = [
        ...new Set([c.ownerId, ...c.opportunities.map((o) => o.ownerId), actor.id].filter((x): x is string => !!x)),
      ];
      const st = CUSTOMER_STATUS[c.status];
      return {
        name: `客户 · ${c.name}`.slice(0, 40),
        ownerId: c.ownerId ?? actor.id,
        memberIds,
        card: {
          template: "generic",
          title: `🏢 ${c.name}`,
          body: c.remark ?? null,
          link: `/crm/customers/${c.id}`,
          actor: c.owner,
          ref: { type: "customer", id: c.id },
          status: st ? { label: st.label, color: st.color === "green" || st.color === "red" || st.color === "blue" ? st.color : st.color === "orange" || st.color === "yellow" ? "orange" : "gray" } : null,
          fields: [
            { label: "编码", value: c.code },
            { label: "级别", value: `${c.level} 级` },
            ...(c.industry ? [{ label: "行业", value: c.industry }] : []),
            ...(c.owner ? [{ label: "负责人", value: c.owner.name }] : []),
          ],
        },
      };
    }
    case "opportunity": {
      if (!hasPermission(actor.permissions, "crm:view")) throw new Error("你没有权限访问该商机");
      const o = await client.opportunity.findUnique({
        where: { id: bizId },
        include: {
          owner: { select: { id: true, name: true, avatarColor: true } },
          customer: { select: { name: true, ownerId: true } },
        },
      });
      if (!o) throw new Error("商机不存在");
      const memberIds = [...new Set([o.ownerId, o.customer.ownerId, actor.id].filter((x): x is string => !!x))];
      const st = OPPORTUNITY_STAGE[o.stage];
      return {
        name: `商机 · ${o.name}`.slice(0, 40),
        ownerId: o.ownerId ?? actor.id,
        memberIds,
        card: {
          template: "generic",
          title: `💡 ${o.name}`,
          link: `/crm/opportunities/${o.id}`,
          actor: o.owner,
          ref: { type: "opportunity", id: o.id },
          status: st ? { label: st.label, color: st.color === "green" || st.color === "red" || st.color === "blue" ? st.color : st.color === "orange" || st.color === "yellow" ? "orange" : "gray" } : null,
          fields: [
            { label: "客户", value: o.customer.name },
            { label: "金额", value: formatMoney(o.amount) },
            { label: "赢率", value: `${o.probability}%` },
          ],
        },
      };
    }
    case "event": {
      if (!hasPermission(actor.permissions, "oa:view")) throw new Error("你没有权限访问该日程");
      const ev = await client.calendarEvent.findUnique({
        where: { id: bizId },
        include: {
          organizer: { select: { id: true, name: true, avatarColor: true } },
          attendees: { select: { userId: true } },
        },
      });
      if (!ev) throw new Error("日程不存在");
      const isParticipant =
        ev.organizerId === actor.id ||
        ev.attendees.some((a) => a.userId === actor.id) ||
        hasPermission(actor.permissions, "admin");
      if (!isParticipant) throw new Error("你不是该日程的组织者或参会人");
      const memberIds = [...new Set([ev.organizerId, ...ev.attendees.map((a) => a.userId), actor.id])];
      const when = formatEventTime(ev.startAt, ev.endAt, ev.allDay);
      return {
        name: `会议 · ${ev.title}`.slice(0, 40),
        ownerId: ev.organizerId,
        memberIds,
        card: {
          template: "generic",
          title: `📅 ${ev.title}`,
          body: ev.description ?? null,
          link: `/oa/calendar?date=${format(ev.startAt, "yyyy-MM-dd")}&event=${ev.id}`,
          actor: ev.organizer,
          ref: { type: "event", id: ev.id },
          status: { label: "会议日程", color: "blue" },
          fields: [
            { label: "时间", value: when },
            ...(ev.location ? [{ label: "地点", value: ev.location }] : []),
            { label: "组织者", value: ev.organizer.name },
          ],
        },
      };
    }
  }
}

/**
 * 获取或创建业务群（项目群 / 客户群 / 商机群 / 日程会议群）。
 * - 已存在：自动确保当前有权限的操作者在群内并取消隐藏。
 * - 未存在：创建带 bizType/bizId 的群聊，写入欢迎系统消息 + 业务摘要卡片。
 */
export async function getOrCreateBizGroup(
  client: DbClient,
  actor: Actor,
  bizType: BizType,
  bizId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const desc = await loadBizDescriptor(client, actor, bizType, bizId);
  const directKey = bizDirectKey(bizType, bizId);

  const ensureJoined = async (conversationId: string) => {
    const existingMember = await client.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
    });
    if (!existingMember) {
      await client.conversationMember.create({ data: { conversationId, userId: actor.id, role: "MEMBER" } });
      await appendMessage(client, {
        conversationId,
        senderId: null,
        type: "SYSTEM",
        content: { text: `${actor.name} 加入了${BIZ_META[bizType].groupLabel}` },
        text: `${actor.name} 加入了${BIZ_META[bizType].groupLabel}`,
        readBy: actor.id,
      });
      queueEvent(await conversationUserIds(client, conversationId), { type: "conversation.updated", conversationId });
    } else if (existingMember.hidden) {
      await client.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId: actor.id } },
        data: { hidden: false },
      });
      queueEvent([actor.id], { type: "conversation.updated", conversationId });
    }
  };

  const existing = await client.conversation.findUnique({ where: { directKey }, select: { id: true } });
  if (existing) {
    await ensureJoined(existing.id);
    return { conversationId: existing.id, created: false };
  }

  // 仅保留有效在职成员
  const activeUsers = await client.user.findMany({
    where: { id: { in: desc.memberIds }, active: true },
    select: { id: true },
  });
  const activeIds = [...new Set([...activeUsers.map((u) => u.id), actor.id])];
  const ownerId = activeIds.includes(desc.ownerId) ? desc.ownerId : actor.id;

  try {
    const conv = await client.conversation.create({
      data: {
        type: "GROUP",
        name: desc.name,
        ownerId,
        directKey,
        bizType,
        bizId,
        members: {
          create: activeIds.map((userId) => ({
            userId,
            role: userId === ownerId ? "OWNER" : "MEMBER",
          })),
        },
      },
    });
    const label = BIZ_META[bizType].groupLabel;
    await appendMessage(client, {
      conversationId: conv.id,
      senderId: null,
      type: "SYSTEM",
      content: { text: `${actor.name} 创建了${label}` },
      text: `${actor.name} 创建了${label}`,
      readBy: actor.id,
    });
    await appendMessage(client, {
      conversationId: conv.id,
      senderId: null,
      type: "CARD",
      content: desc.card,
      text: desc.card.title,
      refType: bizType,
      refId: bizId,
      readBy: actor.id,
    });
    queueEvent(activeIds, { type: "conversation.updated", conversationId: conv.id });
    return { conversationId: conv.id, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const conv = await client.conversation.findUnique({ where: { directKey }, select: { id: true } });
      if (conv) {
        await ensureJoined(conv.id);
        return { conversationId: conv.id, created: false };
      }
    }
    throw e;
  }
}

/** 同步日程更新到关联会议群（新参会人自动入群，时间/地点变更发系统提醒） */
export async function syncEventToMeetingGroup(
  client: DbClient,
  opts: { eventId: string; actorId: string; actorName: string; title: string; addedUserIds: string[]; changeSummary?: string | null },
) {
  const conv = await client.conversation.findUnique({
    where: { directKey: bizDirectKey("event", opts.eventId) },
    select: { id: true },
  });
  if (!conv) return;

  if (opts.addedUserIds.length) {
    const existing = new Set(await conversationUserIds(client, conv.id));
    const toAdd = opts.addedUserIds.filter((id) => !existing.has(id));
    if (toAdd.length) {
      const users = await client.user.findMany({ where: { id: { in: toAdd }, active: true }, select: { id: true, name: true } });
      if (users.length) {
        await client.conversationMember.createMany({ data: users.map((u) => ({ conversationId: conv.id, userId: u.id })) });
        await appendMessage(client, {
          conversationId: conv.id,
          senderId: null,
          type: "SYSTEM",
          content: { text: `${users.map((u) => u.name).join("、")} 因日程更新加入会议群` },
          text: `${users.map((u) => u.name).join("、")} 因日程更新加入会议群`,
          readBy: opts.actorId,
        });
        queueEvent(await conversationUserIds(client, conv.id), { type: "conversation.updated", conversationId: conv.id });
      }
    }
  }

  if (opts.changeSummary) {
    const text = `${opts.actorName} 更新了日程「${opts.title}」：${opts.changeSummary}`;
    await appendMessage(client, {
      conversationId: conv.id,
      senderId: null,
      type: "SYSTEM",
      content: { text },
      text,
      readBy: opts.actorId,
    });
  }
}
