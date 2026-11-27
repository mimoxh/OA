import { requirePermission } from "@/lib/auth/dal";
import { ModuleShell } from "@/components/shell/module-shell";

export default async function PmsLayout({ children }: LayoutProps<"/pms">) {
  await requirePermission("pms:view");
  return <ModuleShell moduleKey="pms" mobileRootContent>{children}</ModuleShell>;
}
