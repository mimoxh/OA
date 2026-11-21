import { Suspense } from "react";
import { requireUser } from "@/lib/auth/dal";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const shellUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    roleName: user.roleName,
    permissions: user.permissions,
  };
  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={shellUser}
        docsSlot={
          <Suspense fallback={<div className="px-2 text-xs text-ink-3">加载文档…</div>}>
            <DocsSidebar userId={user.id} />
          </Suspense>
        }
      />
      <main className="min-w-0 flex-1">{children}</main>
      <CommandPalette permissions={user.permissions} />
    </div>
  );
}
