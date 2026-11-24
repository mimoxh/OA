import Link from "next/link";
import { Users } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { flattenDepartments } from "@/components/settings/dept-utils";
import { ContextPanel } from "@/components/shell/context-panel";
import { Avatar } from "@/components/ui/avatar";
import { SearchInput } from "@/components/ui/common";
import { EmptyState, Page, TopBar } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { MemberCard } from "./member-card";

export const metadata = { title: "通讯录" };

function DeptLink({ href, label, count, depth = 0, active }: { href: string; label: string; count: number; depth?: number; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-active/70",
        active && "bg-active/80 font-medium text-ink",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums text-ink-3">{count}</span>
    </Link>
  );
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  await requireUser();
  const sp = await searchParams;
  const deptId = typeof sp.dept === "string" ? sp.dept : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const [depts, counts] = await Promise.all([
    db.department.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.user.groupBy({ by: ["departmentId"], where: { active: true }, _count: { _all: true } }),
  ]);
  const countMap = new Map(counts.map((c) => [c.departmentId, c._count._all]));
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const flat = flattenDepartments(depts);

  // 选中部门 + 全部下级部门
  let deptIds: string[] | null = null;
  if (deptId && depts.some((d) => d.id === deptId)) {
    deptIds = [deptId];
    const byParent = new Map<string | null, typeof depts>();
    for (const d of depts) (byParent.get(d.parentId) ?? byParent.set(d.parentId, []).get(d.parentId)!).push(d);
    for (let i = 0; i < deptIds.length; i++) {
      for (const c of byParent.get(deptIds[i]) ?? []) deptIds.push(c.id);
    }
  }

  const users = await db.user.findMany({
    where: {
      active: true,
      ...(deptIds ? { departmentId: { in: deptIds } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { title: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    include: { department: { select: { name: true } }, role: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const hrefFor = (dept: string | null) => {
    const p = new URLSearchParams();
    if (dept) p.set("dept", dept);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/contacts?${s}` : "/contacts";
  };

  const selectedName = deptId ? flat.find((d) => d.id === deptId)?.name ?? "部门" : "全部成员";

  return (
    <div className="flex min-h-app">
      <ContextPanel title="通讯录">
        <nav className="space-y-px pt-1">
          <DeptLink href={hrefFor(null)} label="全部成员" count={total} active={!deptId} />
          {flat.map((d) => (
            <DeptLink key={d.id} href={hrefFor(d.id)} label={d.name} count={countMap.get(d.id) ?? 0} depth={d.depth} active={deptId === d.id} />
          ))}
        </nav>
      </ContextPanel>
      <div className="min-w-0 flex-1">
        <TopBar crumbs={[{ label: "通讯录" }, { label: selectedName }]} actions={<SearchInput placeholder="搜索姓名、邮箱、职位、电话…" />} />
        <Page wide>
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
            {users.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<Users />} title="没有找到成员" description="换个搜索词或部门试试。" />
              </div>
            ) : (
              users.map((u) => (
                <MemberCard
                  key={u.id}
                  member={{
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    phone: u.phone,
                    title: u.title,
                    avatarColor: u.avatarColor,
                    departmentName: u.department?.name ?? null,
                    roleName: u.role.name,
                  }}
                >
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover">
                    <Avatar name={u.name} color={u.avatarColor} size={36} />
                    <span className="w-44 min-w-0 shrink-0">
                      <span className="block truncate text-sm font-medium text-ink">{u.name}</span>
                      <span className="block truncate text-xs text-ink-3">{u.title ?? "—"}</span>
                    </span>
                    <span className="hidden w-32 truncate text-sm text-ink-2 sm:block">{u.department?.name ?? "—"}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-sm text-ink-2 md:block">{u.email}</span>
                    <span className="hidden w-32 truncate text-sm text-ink-2 lg:block">{u.phone ?? "—"}</span>
                  </button>
                </MemberCard>
              ))
            )}
          </div>
        </Page>
      </div>
    </div>
  );
}
