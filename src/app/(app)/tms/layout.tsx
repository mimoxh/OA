import { requirePermission } from "@/lib/auth/dal";
import { ModuleShell } from "@/components/shell/module-shell";

export default async function TmsLayout({ children }: LayoutProps<"/tms">) {
  await requirePermission("tms:view");
  return <ModuleShell moduleKey="tms">{children}</ModuleShell>;
}
