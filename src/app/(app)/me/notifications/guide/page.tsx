import { TopBar } from "@/components/ui/page";
import { KeepAliveGuide } from "./guide-client";

export const metadata = { title: "后台保活设置" };

export default function KeepAliveGuidePage() {
  return (
    <div className="min-h-app bg-sidebar pb-8">
      <TopBar crumbs={[{ label: "通知", href: "/me/notifications" }, { label: "后台保活设置" }]} />
      <div className="mx-auto max-w-xl px-3 pt-2">
        <KeepAliveGuide />
      </div>
    </div>
  );
}
