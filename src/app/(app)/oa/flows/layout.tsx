import { requirePermission } from "@/lib/auth/dal";

export default async function FlowsLayout({ children }: LayoutProps<"/oa/flows">) {
  await requirePermission("oa:edit");
  return children;
}
