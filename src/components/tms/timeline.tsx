import { CircleCheck, ClipboardList, MapPin, Truck, UserCheck, XCircle, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const EVENT_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  PENDING: { label: "创建运输单", icon: ClipboardList, cls: "bg-tag-gray text-tag-gray-ink" },
  ASSIGNED: { label: "已调度", icon: UserCheck, cls: "bg-tag-blue text-tag-blue-ink" },
  IN_TRANSIT: { label: "已发车", icon: Truck, cls: "bg-tag-purple text-tag-purple-ink" },
  TRACKING: { label: "在途上报", icon: MapPin, cls: "bg-tag-yellow text-tag-yellow-ink" },
  DELIVERED: { label: "已签收", icon: CircleCheck, cls: "bg-tag-green text-tag-green-ink" },
  CANCELLED: { label: "已取消", icon: XCircle, cls: "bg-tag-red text-tag-red-ink" },
};

export type TimelineEvent = {
  id: string;
  status: string;
  location: string | null;
  note: string | null;
  createdAt: Date;
  user: { name: string; avatarColor: string } | null;
};

/** 跟踪时间线，最新事件在最上方 */
export function TransportTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <div className="py-6 text-center text-sm text-ink-3">暂无跟踪记录</div>;
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const m = EVENT_META[e.status] ?? EVENT_META.TRACKING;
        const Icon = m.icon;
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < events.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line-strong" />}
            <span className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full", m.cls, i === 0 && "ring-4 ring-accent-soft")}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={cn("text-sm font-medium", i === 0 ? "text-ink" : "text-ink-2")}>{m.label}</span>
                {e.location && (
                  <span className="inline-flex items-center gap-0.5 text-[13px] text-ink">
                    <MapPin className="size-3 text-ink-3" />
                    {e.location}
                  </span>
                )}
                <span className="ml-auto whitespace-nowrap text-xs text-ink-3" title={formatDateTime(e.createdAt)}>
                  {formatDateTime(e.createdAt)} · {formatRelative(e.createdAt)}
                </span>
              </div>
              {e.note && <div className="mt-0.5 text-[13px] text-ink-2">{e.note}</div>}
              {e.user && (
                <div className="mt-1 flex items-center gap-1 text-xs text-ink-3">
                  <Avatar name={e.user.name} color={e.user.avatarColor} size={16} />
                  {e.user.name}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
