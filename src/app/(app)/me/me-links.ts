/** 手机「我的」页的入口列表。收件箱不在这里（入口在工作台，桌面在侧边栏；/inbox 路由本身保留） */
export type MeLink = { href: string; label: string; icon: "profile" | "admin" };

export function meLinks({ isAdmin }: { isAdmin: boolean }): MeLink[] {
  const links: MeLink[] = [{ href: "/settings/profile", label: "个人资料", icon: "profile" }];
  if (isAdmin) links.push({ href: "/settings/members", label: "管理后台", icon: "admin" });
  return links;
}
