"use client";

import { useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Check, Clock, MapPin, Trash2, UserRound, Users, X } from "lucide-react";
import type { MemberOption } from "@/lib/oa/types";
import { EVENT_STATUS, PALETTE } from "@/lib/oa/types";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/common";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAction } from "@/components/ui/use-action";
import { ColorPicker } from "@/components/oa/color-picker";
import { MemberMultiSelect } from "@/components/oa/member-picker";
import { BizGroupButton } from "@/components/im/biz-group-button";
import { cn } from "@/lib/utils";
import { deleteEvent, respondEvent, saveEvent } from "./actions";

export type CalEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color: string;
  organizer: { id: string; name: string; avatarColor: string };
  attendees: { userId: string; name: string; avatarColor: string; status: string }[];
  meetingGroupId?: string | null;
};

export type EventDraft = { start: Date; end: Date; allDay: boolean };

const EVENT_COLORS = PALETTE.slice(0, 8);

export function eventTimeText(start: Date, end: Date, allDay: boolean) {
  const day = (d: Date) => format(d, "M月d日 EEE", { locale: zhCN });
  const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
  if (allDay) return sameDay ? `${day(start)} · 全天` : `${day(start)} - ${day(end)} · 全天`;
  return sameDay ? `${day(start)} ${format(start, "HH:mm")} - ${format(end, "HH:mm")}` : `${day(start)} ${format(start, "HH:mm")} - ${day(end)} ${format(end, "HH:mm")}`;
}

const dt = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
const dd = (d: Date) => format(d, "yyyy-MM-dd");

export function EventDialog({
  event,
  draft,
  members,
  meId,
  onClose,
}: {
  event?: CalEvent;
  draft?: EventDraft;
  members: MemberOption[];
  meId: string;
  onClose: () => void;
}) {
  const canEdit = !event || event.organizer.id === meId;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {canEdit ? (
        <EditForm event={event} draft={draft} members={members} meId={meId} onClose={onClose} />
      ) : (
        <EventDetail event={event!} meId={meId} onClose={onClose} />
      )}
    </Dialog>
  );
}

function AttendeeList({ attendees }: { attendees: CalEvent["attendees"] }) {
  if (!attendees.length) return <span className="text-ink-3">无</span>;
  return (
    <div className="space-y-1">
      {attendees.map((a) => {
        const s = EVENT_STATUS[a.status] ?? EVENT_STATUS.pending;
        return (
          <div key={a.userId} className="flex items-center gap-2 text-[13px]">
            <Avatar name={a.name} color={a.avatarColor} size={20} />
            <span className="text-ink">{a.name}</span>
            <Badge color={s.color} className="ml-auto">
              {s.label}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

function EventDetail({ event, meId, onClose }: { event: CalEvent; meId: string; onClose: () => void }) {
  const { run, pending } = useAction();
  const mine = event.attendees.find((a) => a.userId === meId);
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return (
    <DialogContent
      size="md"
      title={
        <span className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded" style={{ backgroundColor: event.color }} />
          {event.title}
        </span>
      }
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <BizGroupButton
              bizType="event"
              bizId={event.id}
              existingConversationId={event.meetingGroupId}
              onAfterNavigate={onClose}
            />
          </div>
          {mine ? (
            <>
              <Button
                variant={mine.status === "declined" ? "danger" : "default"}
                loading={pending}
                onClick={() => run(() => respondEvent(event.id, "declined"), { success: "已拒绝", onSuccess: onClose })}
              >
                <X className="size-3.5" />
                拒绝
              </Button>
              <Button
                variant={mine.status === "accepted" ? "primary" : "default"}
                loading={pending}
                onClick={() => run(() => respondEvent(event.id, "accepted"), { success: "已接受", onSuccess: onClose })}
              >
                <Check className="size-3.5" />
                接受
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>关闭</Button>
          )}
        </>
      }
    >
      <div className="space-y-3 pb-2 text-sm">
        <div className="flex items-center gap-2.5 text-ink">
          <Clock className="size-4 text-ink-3" />
          {eventTimeText(start, end, event.allDay)}
        </div>
        {event.location && (
          <div className="flex items-center gap-2.5 text-ink">
            <MapPin className="size-4 text-ink-3" />
            {event.location}
          </div>
        )}
        <div className="flex items-center gap-2.5 text-ink">
          <UserRound className="size-4 text-ink-3" />
          <Avatar name={event.organizer.name} color={event.organizer.avatarColor} size={20} />
          {event.organizer.name}
          <span className="text-xs text-ink-3">组织者</span>
        </div>
        <div className="flex gap-2.5">
          <Users className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <div className="flex-1">
            <AttendeeList attendees={event.attendees} />
          </div>
        </div>
        {event.description && <div className="whitespace-pre-wrap rounded-md bg-sidebar px-3 py-2 text-[13px] text-ink-2">{event.description}</div>}
        {mine && (
          <div className="text-xs text-ink-3">
            你的回复：<span className={cn(mine.status === "accepted" && "text-[#448361]", mine.status === "declined" && "text-danger")}>{EVENT_STATUS[mine.status]?.label}</span>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

function EditForm({
  event,
  draft,
  members,
  meId,
  onClose,
}: {
  event?: CalEvent;
  draft?: EventDraft;
  members: MemberOption[];
  meId: string;
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  const [init] = useState(() =>
    event
      ? { start: new Date(event.startAt), end: new Date(event.endAt), allDay: event.allDay }
      : (draft ?? { start: new Date(), end: new Date(Date.now() + 3600_000), allDay: false }),
  );
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(init.allDay);
  const [start, setStart] = useState(init.allDay ? dd(init.start) : dt(init.start));
  const [end, setEnd] = useState(init.allDay ? dd(init.end) : dt(init.end));
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [color, setColor] = useState(event?.color ?? EVENT_COLORS[0]);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event?.attendees.map((a) => a.userId) ?? []);

  const toggleAllDay = (v: boolean) => {
    setAllDay(v);
    if (v) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else {
      setStart(`${start.slice(0, 10)}T09:00`);
      setEnd(`${end.slice(0, 10)}T10:00`);
    }
  };

  const save = () =>
    run(
      () =>
        saveEvent({
          id: event?.id,
          title,
          description,
          location,
          allDay,
          color,
          attendeeIds,
          startAt: allDay ? `${start}T00:00` : start,
          endAt: allDay ? `${end}T00:00` : end,
        }),
      { success: event ? "日程已更新" : attendeeIds.length ? "日程已创建，已通知参会人" : "日程已创建", onSuccess: onClose },
    );

  const counts = event?.attendees.reduce<Record<string, number>>((acc, a) => ((acc[a.status] = (acc[a.status] ?? 0) + 1), acc), {});

  return (
    <DialogContent
      size="md"
      title={event ? "编辑日程" : "新建日程"}
      footer={
        <>
          {event && (
            <div className="mr-auto flex items-center gap-1.5">
              <ConfirmButton
                danger
                variant="ghost"
                title="删除日程"
                description={event.attendees.length ? "删除后将通知所有参会人日程已取消。" : "确定删除该日程吗？"}
                confirmText="删除"
                onConfirm={() => run(() => deleteEvent(event.id), { success: "日程已删除", onSuccess: onClose })}
              >
                <Trash2 className="size-3.5" />
                删除
              </ConfirmButton>
              <BizGroupButton
                bizType="event"
                bizId={event.id}
                existingConversationId={event.meetingGroupId}
                onAfterNavigate={onClose}
              />
            </div>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={pending} onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <form
        className="space-y-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input
          autoFocus
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="添加标题"
          className="h-10 border-transparent px-1 text-lg font-semibold hover:border-line-strong"
        />
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <Field label="开始">
            <Input type={allDay ? "date" : "datetime-local"} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="结束">
            <Input type={allDay ? "date" : "datetime-local"} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Checkbox label="全天" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
        <Field label="地点">
          <Input value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} placeholder="会议室或线上会议链接" />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-2">参会人</span>
          <MemberMultiSelect members={members} value={attendeeIds} onChange={setAttendeeIds} exclude={[meId]} addLabel="添加参会人" />
          {event && event.attendees.length > 0 && (
            <div className="mt-2 rounded-md bg-sidebar p-2">
              <div className="mb-1.5 text-xs text-ink-3">
                {counts?.accepted ?? 0} 人接受 · {counts?.declined ?? 0} 人拒绝 · {counts?.pending ?? 0} 人待回复
              </div>
              <AttendeeList attendees={event.attendees} />
            </div>
          )}
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-2">颜色</span>
          <ColorPicker value={color} onChange={setColor} colors={EVENT_COLORS} />
        </div>
        <Field label="描述">
          <Textarea rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="议程、准备材料等" />
        </Field>
      </form>
    </DialogContent>
  );
}
