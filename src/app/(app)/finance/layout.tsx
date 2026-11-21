import { requirePermission } from "@/lib/auth/dal";

export default async function FinanceLayout({ children }: LayoutProps<"/finance">) {
  await requirePermission("finance:view");
  return children;
}
