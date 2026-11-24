import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { getDocAccess, isDocsAdmin } from "@/lib/docs/access";
import { getDatabasePayload, getRowDatabaseContext } from "@/lib/docs/database/server";
import { queryBacklinks } from "@/lib/docs/links";
import { getAncestors, getMentionableUsers } from "@/lib/docs/queries";
import { DocView } from "@/components/docs/doc-view";
import { DatabasePageView } from "@/components/docs/database/database-page-view";
import { WhiteboardPageView } from "@/components/docs/whiteboard/whiteboard-page-view";
import { RecentDocTracker } from "@/components/docs/recent-doc-tracker";
import type { CommentThread } from "@/components/docs/types";

export default async function DocPage({ params, searchParams }: PageProps<"/docs/[id]">) {
  const user = await requirePermission("docs:view");
  const { id } = await params;
  const sp = await searchParams;

  const r = await getDocAccess(user, id);
  if (!r || !r.access.canView || r.doc.deletedAt) notFound();
  const { doc, access } = r;
  const tracker = <RecentDocTracker doc={{ id: doc.id, title: doc.title, icon: doc.icon, kind: doc.kind }} />;

  if (doc.kind === "whiteboard") {
    const [ancestors, favorite, backlinks] = await Promise.all([
      getAncestors(doc.parentId),
      db.documentFavorite.findUnique({ where: { userId_documentId: { userId: user.id, documentId: id } } }),
      queryBacklinks(user, id),
    ]);
    return <>{tracker}<WhiteboardPageView
      key={id}
      board={{ id, title: doc.title, icon: doc.icon, spaceId: doc.spaceId, spaceName: doc.space.name, spaceIcon: doc.space.icon }}
      ancestors={ancestors}
      backlinks={backlinks}
      favorite={!!favorite}
      canWrite={r.canWrite}
    /></>;
  }

  if (doc.kind === "database") {
    const [payload, ancestors, favorite, backlinksData] = await Promise.all([
      getDatabasePayload(user, id),
      getAncestors(doc.parentId),
      db.documentFavorite.findUnique({ where: { userId_documentId: { userId: user.id, documentId: id } } }),
      queryBacklinks(user, id),
    ]);
    return (
      <>
      {tracker}
      <DatabasePageView
        initialData={payload}
        ancestors={ancestors}
        favorite={!!favorite}
        backlinks={backlinksData.links}
        backlinksTruncated={backlinksData.truncated}
      />
      </>
    );
  }

  const [ancestors, children, comments, favorite, members, updatedBy, backlinksData, rowProperties] = await Promise.all([
    getAncestors(doc.parentId),
    db.document.findMany({
      where: { parentId: id, deletedAt: null, isTemplate: false, kind: { not: "row" } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, icon: true },
    }),
    db.comment.findMany({
      where: { targetType: "document", targetId: id },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true, avatarColor: true } } },
    }),
    db.documentFavorite.findUnique({ where: { userId_documentId: { userId: user.id, documentId: id } } }),
    getMentionableUsers(doc.space),
    doc.updatedById ? db.user.findUnique({ where: { id: doc.updatedById }, select: { name: true, avatarColor: true } }) : Promise.resolve(null),
    queryBacklinks(user, id),
    doc.kind === "row" && doc.parentId ? getRowDatabaseContext(user, id, doc.parentId) : Promise.resolve(null),
  ]);

  const threads: CommentThread[] = comments
    .filter((c) => !c.parentId)
    .map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
      author: c.author,
      quote: c.quote,
      resolved: c.resolved,
      replies: comments
        .filter((x) => x.parentId === c.id)
        .map((x) => ({ id: x.id, content: x.content, createdAt: x.createdAt.toISOString(), author: x.author })),
    }));

  return (
    <>
    {tracker}
    <DocView
      doc={{
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        icon: doc.icon,
        cover: doc.cover,
        fullWidth: doc.fullWidth,
        content: doc.content,
        spaceId: doc.spaceId,
        spaceName: doc.space.name,
        spaceIcon: doc.space.icon,
        parentId: doc.parentId,
        updatedAt: doc.updatedAt.toISOString(),
        updatedBy,
      }}
      rowProperties={rowProperties}
      ancestors={ancestors}
      childPages={children}
      backlinks={backlinksData.links}
      backlinksTruncated={backlinksData.truncated}
      threads={threads}
      members={members.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor, title: m.title }))}
      me={{ id: user.id, name: user.name, color: user.avatarColor }}
      canWrite={access.canEdit}
      canAdmin={isDocsAdmin(user)}
      favorite={!!favorite}
      focusComment={typeof sp.comment === "string" ? sp.comment : null}
    />
    </>
  );
}
