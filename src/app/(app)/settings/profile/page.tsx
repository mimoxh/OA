import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { PERMISSION_LABELS, parsePermissions } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { Page, PageHeader, Properties, Property, Section, TopBar } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { PasswordForm, ProfileForm } from "@/components/settings/profile-form";

export default async function ProfilePage() {
  const me = await requireUser();
  const user = await db.user.findUniqueOrThrow({
    where: { id: me.id },
    include: { role: true, department: { include: { manager: { select: { name: true } } } } },
  });
  const perms = parsePermissions(user.role.permissions);
  return (
    <>
      <TopBar crumbs={[{ label: "设置", href: "/settings" }, { label: "个人资料" }]} />
      <Page>
        <PageHeader icon="🙂" title="个人资料" description="管理你的基本信息与登录密码" />
        <ProfileForm initial={{ name: user.name, title: user.title ?? "", phone: user.phone ?? "", avatarColor: user.avatarColor }} />

        <Section title="账号信息" className="mt-10">
          <Properties>
            <Property label="登录邮箱">{user.email}</Property>
            <Property label="部门">{user.department?.name ?? "未分配"}</Property>
            <Property label="直属主管">{user.department?.manager?.name ?? "—"}</Property>
            <Property label="角色">{user.role.name}</Property>
            <Property label="权限">
              <span className="flex flex-wrap gap-1 py-1">
                {perms.map((p) => (
                  <Badge key={p} color={p === "admin" ? "purple" : p.endsWith(":edit") ? "blue" : "gray"}>
                    {PERMISSION_LABELS[p] ?? p}
                  </Badge>
                ))}
              </span>
            </Property>
            <Property label="加入时间">{formatDate(user.createdAt)}</Property>
          </Properties>
          <p className="mt-1 text-xs text-ink-3">邮箱、部门与角色由管理员在「设置 · 成员」中维护。</p>
        </Section>

        <Section title="修改密码" className="mt-10">
          <PasswordForm />
        </Section>
      </Page>
    </>
  );
}
