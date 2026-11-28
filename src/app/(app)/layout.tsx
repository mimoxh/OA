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
      {/* 手机布局 body 已有 padding-top: var(--sat)，外层再占满 100vh 会让整页多出状态栏高度的滚动距离（聊天页底部空白） */}
      <div className={desktop ? "flex h-screen overflow-hidden" : "flex min-h-screen max-md:min-h-[calc(100dvh-var(--sat))]"}>
        {desktop && <style>{":root{--titlebar-h:40px}"}</style>}
        {/* 沉浸式状态栏的底色：页面滚动时内容不从状态栏图标下面透出来；全屏浮层（z-40 起）盖在它上面 */}
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[25] h-[var(--sat)] bg-white md:hidden" />
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
        <div className={desktop ? "mt-[var(--titlebar-h)] h-app min-w-0 flex-1 overflow-y-auto" : "min-w-0 flex-1 max-md:pb-[var(--tabbar-h)]"}>{children}</div>
        <CommandPalette permissions={user.permissions} enabledApps={enabledApps} />
        <CallOverlay me={{ id: user.id, name: user.name, avatarColor: user.avatarColor }} />
      </div>
    </RealtimeProvider>
  );
}
