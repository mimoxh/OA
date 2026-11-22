import Link from "next/link";
import { GitFork, Lock, Star } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth/dal";
import { EmptyState, Page, PageHeader, Section, TopBar } from "@/components/ui/page";
import { formatRelative } from "@/lib/format";
import { spaceAccess, visibleSpaceWhere } from "@/lib/docs/access";
import { DocCard } from "@/components/docs/doc-card";
import { NewPageButton, NewSpaceButton } from "@/components/docs/buttons";
import { SpaceHome } from "./space-home";

const cardSelect = {
  id: true,
  title: true,
  icon: true,
  cover: true,
  text: true,
  updatedAt: true,
  space: { select: { name: true, icon: true } },
  updatedBy: { select: { name: true, avatarColor: true } },
} as const;

export default async function DocsHomePage({ searchParams }: PageProps<"/docs">) {
  const user = await requirePermission("docs:view");
  const sp = await searchParams;
  const spaceId = typeof sp.space === "string" ? sp.space : null;
  if (spaceId) return <SpaceHome user={user} spaceId={spaceId} />;

  const spaces = await db.space.findMany({
    where: visibleSpaceWhere(user),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { members: { select: { userId: true, role: true } } },
  });
  const spaceIds = spaces.map((s) => s.id);
  const live = { deletedAt: null, isTemplate: false, spaceId: { in: spaceIds } };
  const [recent, favorites, counts] = await Promise.all([
    db.document.findMany({ where: live, orderBy: { updatedAt: "desc" }, take: 9, select: cardSelect }),
    db.documentFavorite.findMany({
      where: { userId: user.id, document: live },
      orderBy: { createdAt: "desc" },
      select: { document: { select: cardSelect } },
    }),
    db.document.groupBy({ by: ["spaceId"], where: live, _count: { _all: true } }),
  ]);
  const countBy = new Map(counts.map((c) => [c.spaceId, c._count._all]));
  const editableSpace = spaces.find((s) => spaceAccess(s, user).canEdit);

  return (
    <>
      <TopBar
        crumbs={[{ label: "文档" }]}
        actions={
          <>
            <Link
              href="/docs/graph"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <GitFork className="size-3.5" />
              关系图
            </Link>
            {can(user, "docs:edit") && <NewSpaceButton />}
            {editableSpace && <NewPageButton spaceId={editableSpace.id} />}
          </>
        }
      />
      <Page>
        <PageHeader icon="📚" title="文档" description="团队知识库：记录想法、实时协作、沉淀经验" />

        <Section title="最近编辑">
          {recent.length === 0 ? (
            <EmptyState icon="📝" title="还没有文档" description="在左侧空间中新建第一个页面吧" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((d) => (
                <DocCard key={d.id} doc={d} />
              ))}
            </div>
          )}
        </Section>

        <Section title="我的收藏">
          {favorites.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-5 text-[13px] text-ink-3">
              <Star className="size-4" />
              在文档右上角点击星标即可收藏，方便快速访问
            </div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line">
              {favorites.map(({ document: d }) => (
                <Link key={d.id} href={`/docs/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/60">
                  <span className="text-lg leading-none">{d.icon || "📄"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{d.title || "无标题"}</span>
                  <span className="shrink-0 text-xs text-ink-3">
                    {d.space.icon} {d.space.name}
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs text-ink-3">{formatRelative(d.updatedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title="空间">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((s) => (
              <Link
                key={s.id}
                href={`/docs?space=${s.id}`}
                className="flex gap-3 rounded-lg border border-line bg-white p-4 transition-colors hover:bg-sidebar"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover text-2xl">{s.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                    <span className="truncate">{s.name}</span>
                    {s.visibility === "PRIVATE" && <Lock className="size-3.5 shrink-0 text-ink-3" />}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-2">{s.description || "暂无描述"}</span>
                  <span className="mt-2 block text-xs text-ink-3">
                    {countBy.get(s.id) ?? 0} 个页面 · {s.members.length} 位成员
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </Section>
      </Page>
    </>
  );
}
