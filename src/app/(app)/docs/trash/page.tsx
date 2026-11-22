import Link from "next/link";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, Page, PageHeader, TopBar } from "@/components/ui/page";
import { formatDateTime, formatRelative } from "@/lib/format";
import { spaceAccess, visibleSpaceWhere } from "@/lib/docs/access";
import { EmptyTrashButton, TrashRowActions } from "@/components/docs/trash-actions";

export default async function TrashPage() {
  const user = await requirePermission("docs:view");
  const rows = await db.document.findMany({
    where: { deletedAt: { not: null }, isTemplate: false, space: visibleSpaceWhere(user) },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      icon: true,
      parentId: true,
      deletedAt: true,
      parent: { select: { title: true, deletedAt: true } },
      updatedBy: { select: { name: true, avatarColor: true } },
      space: { include: { members: { select: { userId: true, role: true } } } },
    },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const sameBatch = (r: (typeof rows)[number]) => {
    const p = r.parentId ? byId.get(r.parentId) : undefined;
    return !!p && p.deletedAt?.getTime() === r.deletedAt?.getTime();
  };
  const roots = rows.filter((r) => !sameBatch(r));
  const childCount = new Map<string, number>();
  for (const r of rows) {
    if (!sameBatch(r)) continue;
    let cur = r;
    while (sameBatch(cur)) cur = byId.get(cur.parentId!)!;
    childCount.set(cur.id, (childCount.get(cur.id) ?? 0) + 1);
  }
  const anyEditable = roots.some((r) => spaceAccess(r.space, user).canEdit);

  return (
    <>
      <TopBar crumbs={[{ label: "文档", href: "/docs" }, { label: "回收站" }]} actions={anyEditable ? <EmptyTrashButton count={rows.length} /> : undefined} />
      <Page>
        <PageHeader icon="🗑️" title="回收站" description="删除的页面会保留在这里，可以随时恢复；删除父页面或多维表格时，子页面与记录会一起移入回收站" />
        {roots.length === 0 ? (
          <EmptyState icon={<Trash2 />} title="回收站是空的" description="移到回收站的页面会显示在这里" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {roots.map((r) => {
              const canEdit = spaceAccess(r.space, user).canEdit;
              const n = childCount.get(r.id) ?? 0;
              return (
                <div key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover/40">
                  <span className="text-lg leading-none">{r.icon || (r.kind === "database" ? "🗃️" : "📄")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/docs/${r.id}`} className="truncate text-sm font-medium text-ink hover:underline">
                        {r.title || "无标题"}
                      </Link>
                      {r.kind === "database" && (
                        <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-3">多维表格</span>
                      )}
                      {r.kind === "row" && (
                        <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-3">表格记录</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                      <span>
                        {r.space.icon} {r.space.name}
                      </span>
                      {r.parent && <span>· 原位置：{r.parent.title || "无标题"}</span>}
                      {n > 0 && <span>· 含 {n} {r.kind === "database" ? "条记录" : "个子页面"}</span>}
                      {r.updatedBy && (
                        <span className="flex items-center gap-1">
                          · 最后编辑 <Avatar name={r.updatedBy.name} color={r.updatedBy.avatarColor} size={14} /> {r.updatedBy.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="hidden shrink-0 text-xs text-ink-3 sm:block" title={formatDateTime(r.deletedAt)}>
                    删除于 {formatRelative(r.deletedAt)}
                  </span>
                  {canEdit && <TrashRowActions id={r.id} title={r.title || "无标题"} childCount={n} />}
                </div>
              );
            })}
          </div>
        )}
      </Page>
    </>
  );
}
