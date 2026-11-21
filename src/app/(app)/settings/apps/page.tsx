import { FileText } from "lucide-react";
import { getEnabledApps, requirePermission } from "@/lib/auth/dal";
import { MODULES, type ModuleKey } from "@/lib/permissions";
import { NAV_MODULES } from "@/lib/nav";
import { APP_REQUIRES, appName } from "@/lib/apps";
import { Card, Page, PageHeader, TopBar } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { AppToggle } from "@/components/settings/app-toggle";
import { cn } from "@/lib/utils";

export default async function AppsPage() {
  await requirePermission("admin");
  const enabled = await getEnabledApps();
  const nav = new Map(NAV_MODULES.map((m) => [m.key, m]));
  const dependentsOf = (key: ModuleKey) => MODULES.filter((m) => APP_REQUIRES[m.key].includes(key)).map((m) => m.name);

  return (
    <>
      <TopBar crumbs={[{ label: "设置", href: "/settings" }, { label: "应用管理" }]} />
      <Page>
        <PageHeader icon="🧩" title="应用管理" description="启用或停用各应用；被其他应用依赖的应用不能直接停用，设置、收件箱与首页始终可用" />
        <div className="space-y-3">
          {MODULES.map((m) => {
            const navModule = nav.get(m.key);
            const Icon = navModule?.icon ?? FileText;
            const color = navModule?.color ?? "#787774";
            const on = enabled.has(m.key);
            const requires = APP_REQUIRES[m.key].map(appName);
            const dependents = dependentsOf(m.key);
            return (
              <Card key={m.key} className={cn("flex items-center gap-4 p-4", !on && "opacity-70")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar">
                  <Icon className="size-5" style={{ color }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {m.name}
                    {!on && <Badge>已停用</Badge>}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-3">
                    {m.description}
                    {requires.length > 0 && ` · 依赖：${requires.join("、")}`}
                    {dependents.length > 0 && ` · 被依赖：${dependents.join("、")}`}
                  </span>
                </span>
                <AppToggle appKey={m.key} enabled={on} name={m.name} />
              </Card>
            );
          })}
        </div>
      </Page>
    </>
  );
}
