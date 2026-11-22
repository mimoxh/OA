import { getEnabledApps, requireUser } from "@/lib/auth/dal";
import { AppRail } from "@/components/shell/app-rail";
import { CommandPalette } from "@/components/shell/command-palette";
import { RealtimeProvider } from "@/components/realtime/provider";
import { CallOverlay } from "@/components/call/call-overlay";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const enabledApps = [...(await getEnabledApps())];
  const shellUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    roleName: user.roleName,
    permissions: user.permissions,
  };
  return (
    <RealtimeProvider meId={user.id}>
      <div className="flex min-h-screen">
        <AppRail user={shellUser} enabledApps={enabledApps} />
        <div className="min-w-0 flex-1">{children}</div>
        <CommandPalette permissions={user.permissions} enabledApps={enabledApps} />
        <CallOverlay me={{ id: user.id, name: user.name, avatarColor: user.avatarColor }} />
      </div>
    </RealtimeProvider>
  );
}
