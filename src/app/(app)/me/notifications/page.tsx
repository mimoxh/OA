import { TopBar } from "@/components/ui/page";
import { NotificationSettings } from "./notifications-client";

export const metadata = { title: "通知" };

/** 我的 → 通知：总开关、渠道说明、后台保活状态与引导入口 */
export default function NotificationsPage() {
  return (
    <div className="min-h-app bg-sidebar pb-8">
      <TopBar crumbs={[{ label: "我的", href: "/me" }, { label: "通知" }]} />
      <div className="mx-auto max-w-xl px-3 pt-2">
        <NotificationSettings />
      </div>
    </div>
  );
}
