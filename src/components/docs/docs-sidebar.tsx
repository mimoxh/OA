import { getCurrentUser } from "@/lib/auth/dal";
import { hasPermission } from "@/lib/permissions";
import { getDocsNav } from "@/lib/docs/queries";
import { DocsTree } from "./docs-tree";

/** 侧边栏文档区：收藏 + 各空间页面树 */
export async function DocsSidebar({ userId }: { userId: string }) {
  const user = await getCurrentUser();
  if (!user || user.id !== userId) return null;
  const nav = await getDocsNav(user);
  return <DocsTree {...nav} canCreateSpace={hasPermission(user.permissions, "docs:edit")} />;
}
