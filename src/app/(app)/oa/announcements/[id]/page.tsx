import { notFound } from "next/navigation";
import { Pin } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Card, Page, TopBar } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { CATEGORY_COLOR } from "@/lib/oa/types";
import { SimpleMarkdown } from "@/components/oa/markdown";
import { NotificationsChanged } from "@/components/oa/notifications-changed";
import { AnnouncementAdminActions } from "../announcement-admin-actions";

export default async function AnnouncementPage({ params }: PageProps<"/oa/announcements/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const a = await db.announcement.findUnique({ where: { id }, include: { author: { select: { id: true, name: true, avatarColor: true, title: true } } } });
  if (!a) notFound();

  await db.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: a.id, userId: user.id } },
    create: { announcementId: a.id, userId: user.id },
    update: {},
  });
  const marked = await db.notification.updateMany({
    where: { userId: user.id, read: false, link: `/oa/announcements/${a.id}` },
    data: { read: true },
  });

  const editable = can(user, "oa:edit");
  const showReaders = a.authorId === user.id || can(user, "admin");
  const [reads, users] = await Promise.all([
    db.announcementRead.findMany({ where: { announcementId: a.id }, orderBy: { readAt: "asc" } }),
    db.user.findMany({
      where: { active: true, isBot: false },
      select: { id: true, name: true, avatarColor: true, department: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const readAt = new Map(reads.map((r) => [r.userId, r.readAt]));
  const readUsers = users.filter((u) => readAt.has(u.id));
  const unreadUsers = users.filter((u) => !readAt.has(u.id));

  return (
    <>
      <NotificationsChanged changed={marked.count > 0} />
      <TopBar
        crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "公告通知", href: "/oa/announcements" }, { label: a.title }]}
        actions={
          editable ? (
            <AnnouncementAdminActions
              announcement={{ id: a.id, title: a.title, content: a.content, category: a.category, pinned: a.pinned }}
            />
          ) : undefined
        }
      />
      <Page>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_260px]">
          <article className="min-w-0 max-w-[720px]">
            <header className="pt-10 pb-5">
              <div className="mb-3 text-[44px] leading-none">📢</div>
              <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink">{a.title}</h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
                {a.pinned && (
                  <span className="flex items-center gap-1 text-[#d9730d]">
                    <Pin className="size-3.5 fill-current" />
                    置顶
                  </span>
                )}
                <Badge color={CATEGORY_COLOR[a.category] ?? "gray"}>{a.category}</Badge>
                <UserChip name={a.author.name} color={a.author.avatarColor} />
                <span title={formatDateTime(a.publishedAt)}>发布于 {formatDateTime(a.publishedAt)}</span>
                <span>{readUsers.length} 人已读</span>
              </div>
            </header>
            <div className="border-t border-line pt-4">
              <SimpleMarkdown source={a.content} />
            </div>
          </article>
          <aside className="lg:pt-10">
            {showReaders ? (
              <Card className="p-4">
                <div className="mb-2 flex items-center justify-between text-[13px]">
                  <span className="font-semibold text-ink">阅读情况</span>
                  <span className="text-ink-3">
                    {readUsers.length}/{users.length}
                  </span>
                </div>
                <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-hover">
                  <div className="h-full rounded-full bg-[#448361]" style={{ width: `${users.length ? (readUsers.length / users.length) * 100 : 0}%` }} />
                </div>
                <div className="mb-1.5 text-xs font-medium text-ink-3">未读 {unreadUsers.length}</div>
                <div className="mb-4 space-y-1">
                  {unreadUsers.length === 0 && <div className="text-[13px] text-ink-3">全员已读 🎉</div>}
                  {unreadUsers.map((u) => (
                    <div key={u.id} className="flex items-center gap-2 text-[13px]">
                      <Avatar name={u.name} color={u.avatarColor} size={20} />
                      <span className="text-ink">{u.name}</span>
                      <span className="truncate text-xs text-ink-3">{u.department?.name}</span>
                    </div>
                  ))}
                </div>
                <div className="mb-1.5 text-xs font-medium text-ink-3">已读 {readUsers.length}</div>
                <div className="space-y-1">
                  {readUsers.map((u) => (
                    <div key={u.id} className="flex items-center gap-2 text-[13px]">
                      <Avatar name={u.name} color={u.avatarColor} size={20} />
                      <span className="text-ink">{u.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-ink-3">{formatRelative(readAt.get(u.id))}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="p-4 text-[13px] text-ink-2">
                <div className="mb-2 font-semibold text-ink">发布人</div>
                <div className="flex items-center gap-2">
                  <Avatar name={a.author.name} color={a.author.avatarColor} size={28} />
                  <div>
                    <div className="text-ink">{a.author.name}</div>
                    <div className="text-xs text-ink-3">{a.author.title}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-ink-3">{readUsers.length} 位同事已阅读</div>
              </Card>
            )}
          </aside>
        </div>
      </Page>
    </>
  );
}
