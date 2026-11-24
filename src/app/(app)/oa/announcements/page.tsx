import Link from "next/link";
import { Pin, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ANNOUNCEMENT_CATEGORIES, CATEGORY_COLOR } from "@/lib/oa/types";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { cn } from "@/lib/utils";
import { AnnouncementDialog } from "./announcement-dialog";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

function excerpt(s: string) {
  return s.replace(/[#>*`]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim().slice(0, 120);
}

export default async function AnnouncementsPage({ searchParams }: PageProps<"/oa/announcements">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const category = str(sp.category);
  const unreadOnly = str(sp.status) === "unread";
  const where: Prisma.AnnouncementWhereInput = {
    AND: [
      q ? { OR: [{ title: { contains: q } }, { content: { contains: q } }] } : {},
      category ? { category } : {},
      unreadOnly ? { reads: { none: { userId: user.id } } } : {},
    ],
  };
  const [rows, totalUsers, unreadCount, categoryRows] = await Promise.all([
    db.announcement.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      include: {
        author: { select: { name: true, avatarColor: true } },
        reads: { where: { userId: user.id }, select: { id: true } },
        _count: { select: { reads: true } },
      },
      take: 200,
    }),
    db.user.count({ where: { active: true, isBot: false } }),
    db.announcement.count({ where: { reads: { none: { userId: user.id } } } }),
    db.announcement.groupBy({ by: ["category"], _count: { _all: true } }),
  ]);
  const categories = [...new Set([...ANNOUNCEMENT_CATEGORIES, ...categoryRows.map((c) => c.category)])].filter((c) =>
    categoryRows.some((r) => r.category === c),
  );
  const editable = can(user, "oa:edit");

  return (
    <>
      <TopBar
        crumbs={[{ label: "OA 办公", href: "/oa" }, { label: "公告通知" }]}
        actions={
          editable ? (
            <AnnouncementDialog>
              <Button variant="primary">
                <Plus className="size-3.5" />
                发布公告
              </Button>
            </AnnouncementDialog>
          ) : undefined
        }
      />
      <Page>
        <PageHeader icon="📢" title="公告通知" description={unreadCount ? `你有 ${unreadCount} 条未读公告` : "公司动态、制度与通知"} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput placeholder="搜索公告…" />
          <FilterPills param="category" options={categories.map((c) => ({ value: c, label: c, count: categoryRows.find((r) => r.category === c)?._count._all }))} />
          <div className="ml-auto">
            <FilterPills param="status" options={[{ value: "unread", label: "仅未读", count: unreadCount }]} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="📭" title={q || category || unreadOnly ? "没有符合条件的公告" : "还没有公告"} description={editable ? "点击右上角「发布公告」通知全体成员" : undefined} />
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {rows.map((a) => {
              const read = a.reads.length > 0;
              return (
                <Link key={a.id} href={`/oa/announcements/${a.id}`} className="group flex gap-3 px-1 py-3.5 transition-colors hover:bg-sidebar">
                  <span className="mt-2 flex w-2 justify-center">{!read && <span className="size-2 rounded-full bg-accent" title="未读" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {a.pinned && <Pin className="size-3.5 shrink-0 fill-[#d9730d] text-[#d9730d]" />}
                      <span className={cn("truncate text-[15px] group-hover:underline", read ? "text-ink" : "font-semibold text-ink")}>{a.title}</span>
                      <Badge color={CATEGORY_COLOR[a.category] ?? "gray"}>{a.category}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-1 text-[13px] text-ink-2">{excerpt(a.content)}</p>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-ink-3">
                      <span className="flex items-center gap-1">
                        <Avatar name={a.author.name} color={a.author.avatarColor} size={16} />
                        {a.author.name}
                      </span>
                      <span title={formatDateTime(a.publishedAt)}>{formatRelative(a.publishedAt)}</span>
                      <span>
                        {a._count.reads}/{totalUsers} 已读
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Page>
    </>
  );
}
