"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { isThisWeek, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import { AtSign, Bell, CalendarDays, ClipboardCheck, ListTodo, Mail, MailOpen, Megaphone, MessageSquare, Package, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { NOTIFICATION_TYPE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { deleteNotification, setNotificationRead } from "./actions";

export type InboxItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  actor: { name: string; avatarColor: string } | null;
};

export const TYPE_ICON: Record<string, ReactNode> = {
  mention: <AtSign />,
  comment: <MessageSquare />,
  approval: <ClipboardCheck />,
  task: <ListTodo />,
  order: <Package />,
  announcement: <Megaphone />,
  event: <CalendarDays />,
  system: <Bell />,
};

const TYPE_COLOR: Record<string, string> = {
  mention: "#d9730d",
  comment: "#337ea9",
  approval: "#e16b16",
  task: "#9065b0",
  order: "#2383e2",
  announcement: "#d44c47",
  event: "#448361",
  system: "#787774",
};

function groupLabel(d: Date) {
  if (isToday(d)) return "今天";
  if (isYesterday(d)) return "昨天";
  if (isThisWeek(d, { weekStartsOn: 1 })) return "本周";
  return "更早";
}

function notifyChanged() {
  window.dispatchEvent(new Event("notifications:changed"));
}

type Patch = { id: string; read?: boolean; removed?: boolean };

export function InboxList({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [list, applyPatch] = useOptimistic(items, (state: InboxItem[], p: Patch) =>
    p.removed ? state.filter((i) => i.id !== p.id) : state.map((i) => (i.id === p.id ? { ...i, read: p.read ?? i.read } : i)),
  );

  const mutate = (p: Patch, fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      applyPatch(p);
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "操作失败");
      notifyChanged();
      router.refresh();
    });

  const open = (n: InboxItem) => {
    if (!n.read) {
      setNotificationRead(n.id, true).then(() => notifyChanged());
    }
    if (n.link) router.push(n.link);
    else mutate({ id: n.id, read: true }, () => setNotificationRead(n.id, true));
  };

  const groups: { label: string; items: InboxItem[] }[] = [];
  for (const n of list) {
    const label = groupLabel(new Date(n.createdAt));
    const g = groups.at(-1);
    if (g && g.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-1 px-2 text-xs font-medium text-ink-3">{g.label}</h3>
          <div className="space-y-px">
            {g.items.map((n) => (
              <div
                key={n.id}
                role="link"
                tabIndex={0}
                onClick={() => open(n)}
                onKeyDown={(e) => e.key === "Enter" && open(n)}
                className={cn(
                  "group relative flex cursor-pointer gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-hover",
                  !n.read && "bg-accent-soft/40",
                )}
              >
                <div className="relative mt-0.5 shrink-0">
                  {n.actor ? (
                    <Avatar name={n.actor.name} color={n.actor.avatarColor} size={32} />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-full bg-hover text-ink-2 [&>svg]:size-4">{TYPE_ICON[n.type] ?? <Bell />}</span>
                  )}
                  {n.actor && (
                    <span
                      className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full text-white ring-2 ring-white [&>svg]:size-2.5"
                      style={{ backgroundColor: TYPE_COLOR[n.type] ?? "#787774" }}
                    >
                      {TYPE_ICON[n.type] ?? <Bell />}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className={cn("min-w-0 flex-1 text-sm leading-snug", n.read ? "text-ink-2" : "font-medium text-ink")}>{n.title}</p>
                    <span className="shrink-0 text-xs text-ink-3 group-hover:invisible" title={formatDateTime(n.createdAt)}>
                      {formatRelative(n.createdAt)}
                    </span>
                  </div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{n.body}</p>}
                  <span className="mt-1 inline-block text-[11px] text-ink-3">{NOTIFICATION_TYPE[n.type] ?? n.type}</span>
                </div>
                {!n.read && <span className="absolute right-2 top-1/2 size-2 -translate-y-1/2 rounded-full bg-accent group-hover:hidden" aria-label="未读" />}
                <div className="invisible absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-white shadow-pop group-hover:visible">
                  <IconButton
                    size="md"
                    title={n.read ? "标为未读" : "标为已读"}
                    aria-label={n.read ? "标为未读" : "标为已读"}
                    onClick={(e) => {
                      e.stopPropagation();
                      mutate({ id: n.id, read: !n.read }, () => setNotificationRead(n.id, !n.read));
                    }}
                  >
                    {n.read ? <Mail className="size-3.5" /> : <MailOpen className="size-3.5" />}
                  </IconButton>
                  <IconButton
                    size="md"
                    title="删除"
                    aria-label="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      mutate({ id: n.id, removed: true }, () => deleteNotification(n.id));
                    }}
                    className="hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
