import { requirePermission } from "@/lib/auth/dal";
import { ModuleShell } from "@/components/shell/module-shell";

export default async function ErpLayout({ children }: LayoutProps<"/erp">) {
  await requirePermission("erp:view");
  return <ModuleShell moduleKey="erp">{children}</ModuleShell>;
}
