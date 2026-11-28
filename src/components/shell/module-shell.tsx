import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/dal";
import { NAV_MODULES } from "@/lib/nav";
import { ModuleNav } from "./module-nav";
import { SplitFrame } from "./split-frame";

/**
 * 业务模块外壳：左侧二级导航面板 + 内容区。
 * 手机上模块首页默认直接显示概览内容（页面里用 ModuleEntries 放子页面入口），而不是只有一列菜单。
 */
export async function ModuleShell({
  moduleKey,
  hideOn,
  mobileRootContent = true,
  children,
}: {
  moduleKey: string;
  hideOn?: string[];
  mobileRootContent?: boolean;
  children: ReactNode;
}) {
  const user = await requireUser();
  const mod = NAV_MODULES.find((m) => m.key === moduleKey);
  if (!mod) throw new Error(`未知模块：${moduleKey}`);
  return (
    <SplitFrame root={mod.href} mobileRootContent={mobileRootContent} panel={<ModuleNav moduleKey={mod.key} permissions={user.permissions} hideOn={hideOn} />}>
      {children}
    </SplitFrame>
  );
}
