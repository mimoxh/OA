import Link from "next/link";
import { notFound } from "next/navigation";
import { GitFork, Globe, Lock } from "lucide-react";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/dal";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, Page, PageHeader, Section, TopBar } from "@/components/ui/page";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getSpaceAccess, isDocsAdmin } from "@/lib/docs/access";
import { getAllActiveUsers } from "@/lib/docs/queries";
import { NewDatabaseButton, NewPageButton, NewWhiteboardButton } from "@/components/docs/buttons";
import { SpaceActions, SpaceExportButton, SpaceMembers, TemplateGallery } from "@/components/docs/space-manage";

export async function SpaceHome({ user, spaceId }: { user: CurrentUser; spaceId: string }) {
  const r = await getSpaceAccess(user, spaceId);
  if (!r || !r.access.canView) notFound();
  const { space, access } = r;

  const [docs, members, templates, users] = await Promise.all([
    db.document.findMany({
      where: { spaceId, deletedAt: null, isTemplate: false, kind: { not: "row" } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        icon: true,
        kind: true,
        parentId: true,
        updatedAt: true,
        updatedBy: { select: { name: true, avatarColor: true } },
      },
    }),
    db.spaceMember.findMany({
      where: { spaceId },
      include: { user: { select: { id: true, name: true, avatarColor: true, title: true } } },
    }),
    db.document.findMany({
      where: { spaceId, deletedAt: null, isTemplate: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, icon: true, text: true, createdById: true },
    }),
    access.canManage ? getAllActiveUsers() : Promise.resolve([]),
  ]);

  const ROLE_ORDER: Record<string, number> = { owner: 0, editor: 1, viewer: 2 };
  members.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

  const children = new Map<string | null, typeof docs>();
  const ids = new Set(docs.map((d) => d.id));
  for (const d of docs) {
    const key = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(d);
  }
  const ordered: { doc: (typeof docs)[number]; depth: number }[] = [];
  const walk = (key: string | null, depth: number) => {
    for (const d of children.get(key) ?? []) {
      ordered.push({ doc: d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <>
      <TopBar
        crumbs={[{ label: "文档", href: "/docs" }, { label: `${space.icon} ${space.name}` }]}
        actions={
          <>
            <Link
              href={`/docs/graph?space=${encodeURIComponent(space.id)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <GitFork className="size-3.5" />
              关系图
            </Link>
            <SpaceExportButton spaceId={space.id} />
            {access.canManage && (
              <SpaceActions
                space={{ id: space.id, name: space.name, icon: space.icon, description: space.description, visibility: space.visibility }}
                pageCount={docs.length}
              />
            )}
            {access.canEdit && <NewDatabaseButton spaceId={space.id} />}
            {access.canEdit && <NewWhiteboardButton spaceId={space.id} />}
            {access.canEdit && <NewPageButton spaceId={space.id} />}
          </>
        }
      />
      <Page>
        <PageHeader
          icon={space.icon}
          title={space.name}
          description={space.description || "暂无描述"}
          meta={
            <>
              <span className="flex items-center gap-1.5 text-ink-2">
                {space.visibility === "PRIVATE" ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />}
                {space.visibility === "PRIVATE" ? "私有空间，仅成员可见" : "公开空间，所有拥有文档权限的成员可见"}
              </span>
              <span className="text-ink-2">{docs.length} 个页面</span>
              {members.length > 0 && (
                <span className="flex items-center gap-2 text-ink-2">
                  <AvatarStack users={members.map((m) => m.user)} max={6} />
                  {members.length} 位成员
                </span>
              )}
              {!access.canEdit && <Badge>仅查看</Badge>}
            </>
          }
        />

        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0">
            <Section title="页面" className="mt-0">
              {ordered.length === 0 ? (
                <EmptyState
                  icon="📄"
                  title="空间里还没有页面"
                  description={access.canEdit ? "新建一个页面，或者从下方模板开始" : undefined}
                  action={access.canEdit ? <NewPageButton spaceId={space.id} /> : undefined}
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-line">
                  {ordered.map(({ doc: d, depth }) => (
                    <Link
                      key={d.id}
                      href={`/docs/${d.id}`}
                      className="flex h-10 items-center gap-2 border-b border-line px-3 last:border-b-0 hover:bg-hover/60"
                    >
                      <span style={{ width: depth * 20 }} className="shrink-0" />
                      <span className="text-base leading-none">{d.icon || (d.kind === "database" ? "🗃️" : "📄")}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.title || "无标题"}</span>
                      {d.kind === "database" && <Badge color="blue">多维表格</Badge>}
                      {d.kind === "whiteboard" && <Badge color="blue">白板</Badge>}
                      {d.updatedBy && (
                        <span className="hidden shrink-0 items-center gap-1 text-xs text-ink-3 sm:flex">
                          <Avatar name={d.updatedBy.name} color={d.updatedBy.avatarColor} size={16} />
                          {d.updatedBy.name}
                        </span>
                      )}
                      <span className="w-20 shrink-0 text-right text-xs text-ink-3" title={formatDateTime(d.updatedAt)}>
                        {formatRelative(d.updatedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Section>

            <Section title="模板">
              <TemplateGallery
                spaceId={space.id}
                canEdit={access.canEdit}
                custom={templates.map((t) => ({
                  id: t.id,
                  title: t.title,
                  icon: t.icon,
                  description: t.text.slice(0, 60),
                  canDelete: t.createdById === user.id || isDocsAdmin(user),
                }))}
              />
            </Section>
          </div>

          <aside>
            <Section title="成员" className="mt-0 max-lg:mt-8">
              <Card className="p-3">
                <SpaceMembers
                  spaceId={space.id}
                  canManage={access.canManage}
                  isPrivate={space.visibility === "PRIVATE"}
                  members={members.map((m) => ({ ...m.user, role: m.role }))}
                  users={users.filter((u) => u.canDocs).map(({ id, name, avatarColor, title }) => ({ id, name, avatarColor, title }))}
                />
              </Card>
            </Section>
          </aside>
        </div>
      </Page>
    </>
  );
}
