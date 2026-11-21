import { requirePermission } from "@/lib/auth/dal";

export default async function TmsLayout({ children }: LayoutProps<"/tms">) {
  await requirePermission("tms:view");
  return children;
}
