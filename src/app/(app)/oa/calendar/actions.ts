"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { endOfDay, format, isValid, startOfDay } from "date-fns";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { notify } from "@/lib/services/notify";
import { parseInput } from "@/lib/oa/validate";

const eventSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "请填写日程标题").max(100, "标题不能超过 100 字"),
  description: z.string().trim().max(2000, "描述不能超过 2000 字").optional(),
  location: z.string().trim().max(100, "地点不能超过 100 字").optional(),
  startAt: z.string().min(1, "请选择开始时间"),
  endAt: z.string().min(1, "请选择结束时间"),
  allDay: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确"),
  attendeeIds: z.array(z.string()).max(200, "参会人过多"),
});

export type EventInput = z.input<typeof eventSchema>;

function eventLink(id: string, start: Date) {
  return `/oa/calendar?date=${format(start, "yyyy-MM-dd")}&event=${id}`;
}

function timeText(start: Date, end: Date, allDay: boolean) {
  if (allDay) {
    const s = format(start, "M月d日");
    const e = format(end, "M月d日");
    return s === e ? `${s} 全天` : `${s} - ${e} 全天`;
  }
  const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
  return `${format(start, "M月d日 HH:mm")} - ${format(end, sameDay ? "HH:mm" : "M月d日 HH:mm")}`;
}

export async function saveEvent(input: EventInput) {
  return runAction("oa:view", async (user) => {
    const v = parseInput(eventSchema, input);
    let start = new Date(v.startAt);
    let end = new Date(v.endAt);
    if (!isValid(start) || !isValid(end)) throw new Error("时间格式不正确");
    if (v.allDay) {
      start = startOfDay(start);
      end = endOfDay(end);
    }
    if (end < start) throw new Error("结束时间不能早于开始时间");
    const attendeeIds = [...new Set(v.attendeeIds)].filter((id) => id !== user.id);
    if (attendeeIds.length) {
      const n = await db.user.count({ where: { id: { in: attendeeIds }, active: true } });
      if (n !== attendeeIds.length) throw new Error("部分参会人不存在或已停用");
    }
    const data = {
      title: v.title,
      description: v.description || null,
      location: v.location || null,
      startAt: start,
      endAt: end,
      allDay: v.allDay,
      color: v.color,
    };
    const when = timeText(start, end, v.allDay);

    const id = await db.$transaction(async (tx) => {
      if (!v.id) {
        const ev = await tx.calendarEvent.create({
          data: { ...data, organizerId: user.id, attendees: { create: attendeeIds.map((userId) => ({ userId })) } },
        });
        await notify(tx, {
          userIds: attendeeIds,
          actorId: user.id,
          type: "event",
          title: `${user.name} 邀请你参加「${ev.title}」`,
          body: [when, ev.location].filter(Boolean).join(" · "),
          link: eventLink(ev.id, start),
        });
        return ev.id;
      }
      const ev = await tx.calendarEvent.findUnique({ where: { id: v.id }, include: { attendees: true } });
      if (!ev) throw new Error("日程不存在");
      if (ev.organizerId !== user.id && !user.permissions.includes("admin")) throw new Error("只有组织者可以编辑日程");
      const existing = ev.attendees.map((a) => a.userId);
      const added = attendeeIds.filter((id) => !existing.includes(id) && id !== ev.organizerId);
      const removed = existing.filter((id) => !attendeeIds.includes(id));
      const kept = existing.filter((id) => attendeeIds.includes(id));
      await tx.calendarEvent.update({ where: { id: ev.id }, data });
      if (removed.length) await tx.eventAttendee.deleteMany({ where: { eventId: ev.id, userId: { in: removed } } });
      if (added.length) await tx.eventAttendee.createMany({ data: added.map((userId) => ({ eventId: ev.id, userId })) });
      const link = eventLink(ev.id, start);
      await notify(tx, {
        userIds: added,
        actorId: user.id,
        type: "event",
        title: `${user.name} 邀请你参加「${data.title}」`,
        body: [when, data.location].filter(Boolean).join(" · "),
        link,
      });
      const changed =
        ev.startAt.getTime() !== start.getTime() || ev.endAt.getTime() !== end.getTime() || (ev.location ?? null) !== data.location;
      if (changed) {
        await notify(tx, {
          userIds: kept,
          actorId: user.id,
          type: "event",
          title: `日程「${data.title}」时间或地点已变更`,
          body: [when, data.location].filter(Boolean).join(" · "),
          link,
        });
      }
      return ev.id;
    });
    revalidatePath("/oa/calendar");
    return { id };
  });
}

export async function deleteEvent(id: string) {
  return runAction("oa:view", async (user) => {
    const ev = await db.calendarEvent.findUnique({ where: { id: parseInput(z.string().min(1), id) }, include: { attendees: true } });
    if (!ev) throw new Error("日程不存在");
    if (ev.organizerId !== user.id && !user.permissions.includes("admin")) throw new Error("只有组织者可以删除日程");
    await db.$transaction(async (tx) => {
      await tx.calendarEvent.delete({ where: { id: ev.id } });
      await notify(tx, {
        userIds: ev.attendees.map((a) => a.userId),
        actorId: user.id,
        type: "event",
        title: `${user.name} 取消了日程「${ev.title}」`,
        body: timeText(ev.startAt, ev.endAt, ev.allDay),
        link: `/oa/calendar?date=${format(ev.startAt, "yyyy-MM-dd")}`,
      });
    });
    revalidatePath("/oa/calendar");
  });
}

export async function respondEvent(id: string, status: "accepted" | "declined") {
  return runAction("oa:view", async (user) => {
    const s = parseInput(z.enum(["accepted", "declined"]), status);
    const ev = await db.calendarEvent.findUnique({ where: { id: parseInput(z.string().min(1), id) } });
    if (!ev) throw new Error("日程不存在");
    const att = await db.eventAttendee.findUnique({ where: { eventId_userId: { eventId: ev.id, userId: user.id } } });
    if (!att) throw new Error("你不是该日程的参会人");
    await db.$transaction(async (tx) => {
      await tx.eventAttendee.update({ where: { id: att.id }, data: { status: s } });
      if (att.status !== s) {
        await notify(tx, {
          userIds: [ev.organizerId],
          actorId: user.id,
          type: "event",
          title: `${user.name} ${s === "accepted" ? "接受" : "拒绝"}了日程「${ev.title}」`,
          link: eventLink(ev.id, ev.startAt),
        });
      }
    });
    revalidatePath("/oa/calendar");
  });
}
