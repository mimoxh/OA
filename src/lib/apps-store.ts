import { db, type DbClient } from "@/lib/db";
import { MODULES, type ModuleKey } from "@/lib/permissions";

// 该文件同时被 Next 服务端与 server/collab.ts（tsx）使用，不能引入 server-only / next/*。
export async function getDisabledApps(client: DbClient = db): Promise<Set<ModuleKey>> {
  const rows = await client.appSetting.findMany({ where: { enabled: false }, select: { key: true } });
  const disabled = new Set(rows.map((r) => r.key));
  return new Set(MODULES.map((m) => m.key).filter((k) => disabled.has(k)));
}

export async function getEnabledAppKeys(client: DbClient = db): Promise<Set<ModuleKey>> {
  const disabled = await getDisabledApps(client);
  return new Set(MODULES.map((m) => m.key).filter((k) => !disabled.has(k)));
}
