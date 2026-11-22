import { requirePermission } from "@/lib/auth/dal";
import { ModuleShell } from "@/components/shell/module-shell";

export default async function FinanceLayout({ children }: LayoutProps<"/finance">) {
  await requirePermission("finance:view");
  return <ModuleShell moduleKey="finance">{children}</ModuleShell>;
}
