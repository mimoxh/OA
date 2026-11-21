import { requirePermission } from "@/lib/auth/dal";

export default async function CrmLayout({ children }: LayoutProps<"/crm">) {
  await requirePermission("crm:view");
  return children;
}
