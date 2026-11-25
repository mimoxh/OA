import Link from "next/link";
import { ChevronRight, Inbox, Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/dal";
import { hasPermission } from "@/lib/permissions";
import { Avatar } from "@/components/ui/avatar";
import { MeAppSection, MeLogout } from "./me-client";

export const metadata = { title: "我的" };

function Row({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 active:bg-hover md:hover:bg-hover">
      <span className="text-ink-2 [&>svg]:size-5">{icon}</span>
      <span className="flex-1 text-[15px] text-ink">{label}</span>
      <ChevronRight className="size-4 text-ink-3" />
    </Link>
  );
}

/** 手机端「我的」：账户信息、设置入口、App 壳层信息（服务器、通知、版本）与退出登录 */
export default async function MePage() {
  const user = await requireUser();
  const isAdmin = hasPermission(user.permissions, "admin");
  return (
    <div className="min-h-app bg-sidebar pb-8">
      <div className="mx-auto max-w-xl px-3 pt-4">
        <div className="flex items-center gap-3 rounded-xl bg-white p-4">
          <Avatar name={user.name} color={user.avatarColor} size={56} />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-ink">{user.name}</div>
            <div className="truncate text-[13px] text-ink-3">{user.email}</div>
            <div className="mt-0.5 truncate text-xs text-ink-3">{[user.departmentName, user.roleName].filter(Boolean).join(" · ")}</div>
          </div>
        </div>

        <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl bg-white">
          <Row href="/settings/profile" icon={<UserRound />} label="个人资料" />
          <Row href="/inbox" icon={<Inbox />} label="收件箱" />
          {isAdmin && <Row href="/settings/members" icon={<Settings />} label="管理后台" />}
        </div>

        <MeAppSection />
        <MeLogout />
      </div>
    </div>
  );
}
