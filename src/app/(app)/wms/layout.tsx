import { requirePermission } from "@/lib/auth/dal";
import { ModuleShell } from "@/components/shell/module-shell";

export default async function WmsLayout({ children }: LayoutProps<"/wms">) {
  await requirePermission("wms:view");
  return <ModuleShell moduleKey="wms">{children}</ModuleShell>;
}
