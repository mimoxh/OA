import { requirePermission } from "@/lib/auth/dal";
import { ModuleShell } from "@/components/shell/module-shell";

export default async function OaLayout({ children }: LayoutProps<"/oa">) {
  await requirePermission("oa:view");
  return <ModuleShell moduleKey="oa" hideOn={["/oa/calendar"]}>{children}</ModuleShell>;
}
