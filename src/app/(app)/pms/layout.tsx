import { requirePermission } from "@/lib/auth/dal";

export default async function PmsLayout({ children }: LayoutProps<"/pms">) {
  await requirePermission("pms:view");
  return children;
}
