import { Suspense } from "react";
import { getEnabledApps, requireUser } from "@/lib/auth/dal";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const enabled = await getEnabledApps();
  const enabledApps = [...enabled];
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
        enabledApps={enabledApps}
        docsSlot={
          enabled.has("docs") ? (
            <Suspense fallback={<div className="px-2 text-xs text-ink-3">加载文档…</div>}>
              <DocsSidebar userId={user.id} />
            </Suspense>
          ) : null
        }
      />
      <main className="min-w-0 flex-1">{children}</main>
      <CommandPalette permissions={user.permissions} enabledApps={enabledApps} />
    </div>
  );
}
