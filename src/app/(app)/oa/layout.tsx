import { requirePermission } from "@/lib/auth/dal";

export default async function OaLayout({ children }: LayoutProps<"/oa">) {
  await requirePermission("oa:view");
  return children;
}
