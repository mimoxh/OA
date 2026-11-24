import { getEnabledApps, requireUser } from "@/lib/auth/dal";
import { AppRail } from "@/components/shell/app-rail";
import { CommandPalette } from "@/components/shell/command-palette";
import { RealtimeProvider } from "@/components/realtime/provider";
import { CallOverlay } from "@/components/call/call-overlay";
import { DesktopTopBar } from "@/components/desktop/desktop-topbar";
import { isDesktopRequest } from "@/lib/desktop";
import { getRailData } from "@/lib/shell/rail";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const enabled = await getEnabledApps();
  const enabledApps = [...enabled];
  const [desktop, rail] = await Promise.all([isDesktopRequest(), getRailData(user, enabled)]);
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
      <div className={desktop ? "flex h-screen overflow-hidden" : "flex min-h-screen"}>
        {desktop && <style>{":root{--titlebar-h:40px}"}</style>}
        <AppRail
          user={shellUser}
          enabledApps={enabledApps}
          railPins={user.railPins}
          railOrder={user.railOrder}
          projects={rail.projects}
          recentDocs={rail.recentDocs}
        />
        {desktop && <DesktopTopBar />}
        {/* 桌面端内容区自行滚动：滚动条从顶栏下方开始，不挤占顶栏和窗口按钮 */}
        <div className={desktop ? "mt-[var(--titlebar-h)] h-app min-w-0 flex-1 overflow-y-auto" : "min-w-0 flex-1"}>{children}</div>
        <CommandPalette permissions={user.permissions} enabledApps={enabledApps} />
        <CallOverlay me={{ id: user.id, name: user.name, avatarColor: user.avatarColor }} />
      </div>
    </RealtimeProvider>
  );
}
