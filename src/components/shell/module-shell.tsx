import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/dal";
import { NAV_MODULES } from "@/lib/nav";
import { ModuleNav } from "./module-nav";

/** 业务模块外壳：左侧二级导航面板 + 内容区 */
export async function ModuleShell({
  moduleKey,
  hideOn,
  children,
}: {
  moduleKey: string;
  hideOn?: string[];
  children: ReactNode;
}) {
  const user = await requireUser();
  const mod = NAV_MODULES.find((m) => m.key === moduleKey);
  if (!mod) throw new Error(`未知模块：${moduleKey}`);
  return (
    <div className="flex min-h-screen">
      <ModuleNav moduleKey={mod.key} permissions={user.permissions} hideOn={hideOn} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
