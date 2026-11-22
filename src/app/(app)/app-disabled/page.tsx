import Link from "next/link";
import { PowerOff } from "lucide-react";
import { can, requireUser } from "@/lib/auth/dal";
import { appName, moduleOfPermission } from "@/lib/apps";
import { buttonClass } from "@/components/ui/button";

export default async function AppDisabledPage({ searchParams }: PageProps<"/app-disabled">) {
  const user = await requireUser();
  const sp = await searchParams;
  const app = typeof sp.app === "string" ? sp.app : "";
  const key = app ? moduleOfPermission(`${app}:view`) : null;
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <PowerOff className="mb-4 size-10 text-ink-3" />
      <h1 className="text-xl font-semibold text-ink">{key ? `「${appName(key)}」应用已停用` : "应用已停用"}</h1>
      <p className="mt-2 text-sm text-ink-2">请联系管理员在「设置 · 应用管理」中启用。</p>
      <div className="mt-6 flex items-center gap-2">
        <Link href="/work" className={buttonClass("default", "md")}>
          返回工作台
        </Link>
        {can(user, "admin") && (
          <Link href="/settings/apps" className={buttonClass("primary", "md")}>
            前往应用管理
          </Link>
        )}
      </div>
    </div>
  );
}
