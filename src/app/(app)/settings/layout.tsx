import { can, requireUser } from "@/lib/auth/dal";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-app">
      <SettingsNav isAdmin={can(user, "admin")} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
