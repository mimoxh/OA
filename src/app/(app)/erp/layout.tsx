import { requirePermission } from "@/lib/auth/dal";

export default async function ErpLayout({ children }: LayoutProps<"/erp">) {
  await requirePermission("erp:view");
  return children;
}
