import { requirePermission } from "@/lib/auth/dal";

export default async function WmsLayout({ children }: LayoutProps<"/wms">) {
  await requirePermission("wms:view");
  return children;
}
