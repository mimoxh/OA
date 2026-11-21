import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { getMemberOptions } from "@/lib/oa/server";
import { Page, PageHeader, TopBar } from "@/components/ui/page";
import { DepartmentTree } from "@/components/settings/department-tree";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function DepartmentsPage({ searchParams }: PageProps<"/settings/departments">) {
  await requirePermission("admin");
  const sp = await searchParams;
  const [departments, users, members] = await Promise.all([
    db.department.findMany({ include: { _count: { select: { members: true } } } }),
    db.user.findMany({
      where: { departmentId: { not: null } },
      select: { id: true, name: true, avatarColor: true, title: true, departmentId: true, active: true, role: { select: { name: true } } },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    }),
    getMemberOptions(),
  ]);
  return (
    <>
      <TopBar crumbs={[{ label: "设置", href: "/settings" }, { label: "部门" }]} />
      <Page wide>
        <PageHeader icon="🏢" title="部门" description="维护组织架构与部门负责人；部门负责人即审批流程中的「直属主管」" />
        <DepartmentTree
          departments={departments.map((d) => ({
            id: d.id,
            name: d.name,
            parentId: d.parentId,
            sortOrder: d.sortOrder,
            managerId: d.managerId,
            memberCount: d._count.members,
          }))}
          users={users.map((u) => ({ ...u, roleName: u.role.name }))}
          members={members}
          selectedId={str(sp.dept) || null}
        />
      </Page>
    </>
  );
}
