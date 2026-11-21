import Link from "next/link";
import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { parsePermissions, PERMISSION_LABELS } from "@/lib/permissions";
import { Card, Page, PageHeader, TopBar } from "@/components/ui/page";
import { NewRoleButton, RoleEditor } from "@/components/settings/role-editor";
import { cn } from "@/lib/utils";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

function summary(perms: string[]) {
  if (perms.includes("admin")) return "全部权限";
  const edit = perms.filter((p) => p.endsWith(":edit")).length;
  const view = perms.filter((p) => p.endsWith(":view")).length;
  return `${edit} 个模块可编辑 · ${view} 个仅查看`;
}

export default async function RolesPage({ searchParams }: PageProps<"/settings/roles">) {
  await requirePermission("admin");
  const sp = await searchParams;
  const roles = await db.role.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      users: { select: { id: true, name: true, avatarColor: true, title: true, active: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const selected = roles.find((r) => r.id === str(sp.role)) ?? roles[0];

  return (
    <>
      <TopBar
        crumbs={[{ label: "设置", href: "/settings" }, { label: "角色权限" }]}
        actions={<NewRoleButton roles={roles.map((r) => ({ id: r.id, name: r.name, permissions: parsePermissions(r.permissions) }))} />}
      />
      <Page wide>
        <PageHeader icon="🔐" title="角色权限" description="按模块为角色分配查看 / 编辑权限，成员的侧边栏与可访问页面随之变化" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          <Card className="h-fit p-1.5">
            {roles.map((r) => {
              const perms = parsePermissions(r.permissions);
              return (
                <Link
                  key={r.id}
                  href={`/settings/roles?role=${r.id}`}
                  scroll={false}
                  className={cn("block rounded-md px-2.5 py-2 transition-colors hover:bg-hover", selected?.id === r.id && "bg-active/70")}
                  title={perms.map((p) => PERMISSION_LABELS[p] ?? p).join("、")}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    {r.name}
                    {r.system && <Lock className="size-3 text-ink-3" />}
                    <span className="ml-auto text-xs font-normal tabular-nums text-ink-3">{r.users.length} 人</span>
                  </span>
                  <span className="block truncate text-xs text-ink-3">{summary(perms)}</span>
                </Link>
              );
            })}
          </Card>
          {selected && (
            <RoleEditor
              key={selected.id + selected.permissions + selected.name}
              role={{
                id: selected.id,
                key: selected.key,
                name: selected.name,
                description: selected.description,
                system: selected.system,
                permissions: parsePermissions(selected.permissions),
                users: selected.users,
              }}
            />
          )}
        </div>
      </Page>
    </>
  );
}
