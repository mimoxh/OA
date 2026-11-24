import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { FilterPills, SearchInput } from "@/components/ui/common";
import { UrlSelect } from "@/components/oa/url-select";
import { flattenDepartments, deptOptionLabel } from "@/components/settings/dept-utils";
import { NewMemberButton, type MemberRow } from "@/components/settings/member-dialogs";
import { MembersTable } from "@/components/settings/members-table";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const include = { role: { select: { name: true } }, department: { select: { name: true } } } satisfies Prisma.UserInclude;

function toRow(u: Prisma.UserGetPayload<{ include: typeof include }>): MemberRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarColor: u.avatarColor,
    title: u.title,
    phone: u.phone,
    active: u.active,
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
    roleId: u.roleId,
    roleName: u.role.name,
    createdAt: u.createdAt.toISOString(),
  };
}

export default async function MembersPage({ searchParams }: PageProps<"/settings/members">) {
  const me = await requirePermission("admin");
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const dept = str(sp.dept);
  const role = str(sp.role);
  const selectedId = str(sp.user);

  const where: Prisma.UserWhereInput = {
    isBot: false,
    AND: [
      q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { title: { contains: q } }, { phone: { contains: q } }] } : {},
      status === "active" ? { active: true } : status === "inactive" ? { active: false } : {},
      dept ? { departmentId: dept } : {},
      role ? { roleId: role } : {},
    ],
  };

  const [users, departments, roles, counts, selected] = await Promise.all([
    db.user.findMany({ where, include, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    db.department.findMany({ select: { id: true, name: true, parentId: true, sortOrder: true } }),
    db.role.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, key: true } }),
    db.user.groupBy({ by: ["active"], where: { isBot: false }, _count: { _all: true } }),
    selectedId ? db.user.findFirst({ where: { id: selectedId, isBot: false }, include }) : Promise.resolve(null),
  ]);
  const deptOptions = flattenDepartments(departments).map((d) => ({ id: d.id, name: d.name, depth: d.depth }));
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }));
  const active = counts.find((c) => c.active)?._count._all ?? 0;
  const inactive = counts.find((c) => !c.active)?._count._all ?? 0;

  return (
    <>
      <TopBar
        crumbs={[{ label: "设置", href: "/settings" }, { label: "成员" }]}
        actions={
          <NewMemberButton departments={deptOptions} roles={roleOptions} defaultRoleId={roles.find((r) => r.key === "member")?.id ?? roles[0]?.id ?? ""} />
        }
      />
      <Page wide>
        <PageHeader icon="👥" title="成员" description={`共 ${active} 名在职成员${inactive ? `，${inactive} 名已停用` : ""}`} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput placeholder="搜索姓名、邮箱、职位、手机…" className="w-64" />
          <UrlSelect param="dept" placeholder="全部部门" options={deptOptions.map((d) => ({ value: d.id, label: deptOptionLabel(d) }))} />
          <UrlSelect param="role" placeholder="全部角色" options={roleOptions.map((r) => ({ value: r.id, label: r.name }))} />
          <FilterPills
            options={[
              { value: "active", label: "正常", count: active },
              { value: "inactive", label: "已停用", count: inactive },
            ]}
          />
        </div>
        <MembersTable
          members={users.map(toRow)}
          selected={selected ? toRow(selected) : null}
          departments={deptOptions}
          roles={roleOptions}
          meId={me.id}
        />
      </Page>
    </>
  );
}
