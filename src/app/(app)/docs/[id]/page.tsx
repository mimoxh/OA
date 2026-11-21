import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { getDocAccess, isDocsAdmin } from "@/lib/docs/access";
import { getAncestors, getMentionableUsers } from "@/lib/docs/queries";
import { DocView } from "@/components/docs/doc-view";
import type { CommentThread } from "@/components/docs/types";

export default async function DocPage({ params, searchParams }: PageProps<"/docs/[id]">) {
  const user = await requirePermission("docs:view");
  const { id } = await params;
  const sp = await searchParams;

  const r = await getDocAccess(user, id);
  if (!r || !r.access.canView || r.doc.deletedAt) notFound();
  const { doc, access } = r;

  const [ancestors, children, comments, favorite, members, updatedBy] = await Promise.all([
    getAncestors(doc.parentId),
    db.document.findMany({
      where: { parentId: id, deletedAt: null, isTemplate: false },
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
    <DocView
      doc={{
        id: doc.id,
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
      ancestors={ancestors}
      childPages={children}
      threads={threads}
      members={members.map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor, title: m.title }))}
      me={{ id: user.id, name: user.name, color: user.avatarColor }}
      canWrite={access.canEdit}
      canAdmin={isDocsAdmin(user)}
      favorite={!!favorite}
      focusComment={typeof sp.comment === "string" ? sp.comment : null}
    />
  );
}
