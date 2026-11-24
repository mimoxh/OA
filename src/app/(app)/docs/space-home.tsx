import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderKanban, GitFork, Globe, Lock, Settings2 } from "lucide-react";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/dal";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, Page, PageHeader, Section, TopBar } from "@/components/ui/page";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getSpaceAccess, isDocsAdmin } from "@/lib/docs/access";
import { getAllActiveUsers } from "@/lib/docs/queries";
import { NewDatabaseButton, NewPageButton, NewWhiteboardButton } from "@/components/docs/buttons";
import { SpaceActions, SpaceDeleteButton, SpaceExportButton, SpaceMembers, TemplateGallery } from "@/components/docs/space-manage";
import { SpaceSettingsForm } from "@/components/docs/space-dialog";

export async function SpaceHome({ user, spaceId, settings = false }: { user: CurrentUser; spaceId: string; settings?: boolean }) {
  const r = await getSpaceAccess(user, spaceId);
  if (!r || !r.access.canView) notFound();
  const { space, access } = r;
  const personal = !!space.ownerId;

  const [docs, members, templates, users, project] = await Promise.all([
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
    access.canManage && !personal ? getAllActiveUsers() : Promise.resolve([]),
    db.project.findUnique({ where: { spaceId }, select: { id: true, name: true } }),
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

  const projectHint = project && (
    <p className="mb-2 flex items-start gap-1.5 px-1 text-xs text-ink-2">
      <FolderKanban className="mt-px size-3.5 shrink-0" />
      <span>
        成员与项目「
        <Link href={`/pms/projects/${project.id}?view=members`} className="text-accent hover:underline">
          {project.name}
        </Link>
        」同步：负责人为所有者，成员可编辑，只读成员仅查看。
      </span>
    </p>
  );
  const memberList = personal ? (
    <p className="px-1 py-1 text-[13px] text-ink-3">这是你的个人空间，只有你自己能看到，管理员也无法访问。</p>
  ) : (
    <>
      {projectHint}
      <SpaceMembers
        spaceId={space.id}
        canManage={access.canManage && !project}
        isPrivate={space.visibility === "PRIVATE"}
        members={members.map((m) => ({ ...m.user, role: m.role }))}
        users={users.filter((u) => u.canDocs).map(({ id, name, avatarColor, title }) => ({ id, name, avatarColor, title }))}
      />
    </>
  );
  const spaceValue = {
    id: space.id,
    name: space.name,
    icon: space.icon,
    description: space.description,
    visibility: space.visibility,
    personal,
  };

  if (settings) {
    return (
      <>
        <TopBar crumbs={[{ label: "文档", href: "/docs" }, { label: `${space.icon} ${space.name}`, href: `/docs?space=${space.id}` }, { label: "空间设置" }]} />
        <Page>
          <Link href={`/docs?space=${space.id}`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
            <ArrowLeft className="size-3.5" />
            返回空间
          </Link>
          <PageHeader icon={space.icon} title="空间设置与成员" description={space.name} />
          <Section title="基本信息" className="mt-0">
            <Card className="p-4">
              {access.canManage ? (
                <SpaceSettingsForm space={spaceValue} />
              ) : (
                <div className="space-y-1 text-[13px] text-ink-2">
                  <p>
                    {space.icon} {space.name}
                  </p>
                  <p>{space.description || "暂无描述"}</p>
                  <p className="text-xs text-ink-3">只有空间所有者或文档管理员可以修改空间设置</p>
                </div>
              )}
            </Card>
          </Section>
          <Section title={`成员（${personal ? 1 : members.length}）`}>
            <Card className="p-3">{memberList}</Card>
          </Section>
          {access.canManage && !personal && (
            <Section title="危险操作">
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="text-[13px] text-ink-2">删除空间会永久删除其中的 {docs.length} 个页面，无法恢复。</div>
                <SpaceDeleteButton space={space} pageCount={docs.length} />
              </Card>
            </Section>
          )}
        </Page>
      </>
    );
  }

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
              <SpaceActions space={spaceValue} pageCount={docs.length} />
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
                {personal
                  ? "个人空间，仅自己可见"
                  : space.visibility === "PRIVATE"
                    ? "私有空间，仅成员可见"
                    : "公开空间，所有拥有文档权限的成员可见"}
              </span>
              <span className="text-ink-2">{docs.length} 个页面</span>
              {!personal && members.length > 0 && (
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
            <Section
              title="成员"
              className="mt-0 max-lg:mt-8"
              actions={
                <Link href={`/docs?space=${space.id}&settings=1`} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
                  <Settings2 className="size-3" />
                  设置
                </Link>
              }
            >
              <Card className="p-3">{memberList}</Card>
            </Section>
          </aside>
        </div>
      </Page>
    </>
  );
}
