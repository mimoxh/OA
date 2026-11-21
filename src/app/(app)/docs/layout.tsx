import { requirePermission } from "@/lib/auth/dal";

export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  await requirePermission("docs:view");
  return children;
}
