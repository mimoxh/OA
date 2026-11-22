import { requirePermission } from "@/lib/auth/dal";
import { ModuleShell } from "@/components/shell/module-shell";

export default async function CrmLayout({ children }: LayoutProps<"/crm">) {
  await requirePermission("crm:view");
  return <ModuleShell moduleKey="crm">{children}</ModuleShell>;
}
