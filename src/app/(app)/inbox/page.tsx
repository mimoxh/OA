import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { NOTIFICATION_TYPE } from "@/lib/labels";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { FilterPills } from "@/components/ui/common";
import { QueryTabs } from "@/components/oa/query-tabs";
import { InboxList } from "./inbox-list";
import { InboxToolbar } from "./inbox-toolbar";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const TYPES = ["mention", "comment", "approval", "task", "order", "announcement", "event", "system"];

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const user = await requireUser();
  const sp = await searchParams;
  const unreadOnly = str(sp.filter) === "unread";
  const type = TYPES.includes(str(sp.type)) ? str(sp.type) : "";
  const base: Prisma.NotificationWhereInput = { userId: user.id };
  const where: Prisma.NotificationWhereInput = { ...base, ...(unreadOnly ? { read: false } : {}), ...(type ? { type } : {}) };

  const [rows, unreadTotal, byType, readCount] = await Promise.all([
    db.notification.findMany({
      where,
      include: { actor: { select: { name: true, avatarColor: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    db.notification.count({ where: { ...base, read: false } }),
    db.notification.groupBy({ by: ["type"], where: { ...base, ...(unreadOnly ? { read: false } : {}) }, _count: { _all: true } }),
    db.notification.count({ where: { ...base, read: true } }),
  ]);
  const typeUnread = type ? await db.notification.count({ where: { ...base, read: false, type } }) : unreadTotal;

  return (
    <>
      <TopBar
        crumbs={[{ label: "收件箱" }]}
        actions={<InboxToolbar type={type || undefined} unread={typeUnread} hasRead={readCount > 0} />}
      />
      <Page>
        <PageHeader icon="📥" title="收件箱" description={unreadTotal ? `${unreadTotal} 条未读通知` : "所有通知都已读"} />
        <QueryTabs
          param="filter"
          defaultValue="all"
          keep={["type"]}
          items={[
            { value: "all", label: "全部" },
            { value: "unread", label: "未读", count: unreadTotal },
          ]}
        />
        <div className="py-3">
          <FilterPills
            param="type"
            options={TYPES.filter((t) => byType.some((b) => b.type === t) || t === type).map((t) => ({
              value: t,
              label: NOTIFICATION_TYPE[t] ?? t,
              count: byType.find((b) => b.type === t)?._count._all ?? 0,
            }))}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon="📭"
            title={unreadOnly ? "没有未读通知" : "收件箱是空的"}
            description="审批、评论、@提及、任务、公告和日程邀请等通知都会出现在这里"
          />
        ) : (
          <InboxList
            items={rows.map((n) => ({
              id: n.id,
              type: n.type,
              title: n.title,
              body: n.body,
              link: n.link,
              read: n.read,
              createdAt: n.createdAt.toISOString(),
              actor: n.actor,
            }))}
          />
        )}
      </Page>
    </>
  );
}
