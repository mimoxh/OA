import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { handleCatalogSync } from "@/lib/im/orca-catalog-sync";
import { invalidateOrcaCatalogCache } from "@/lib/im/orca-catalog-service";

// 运行 Orca 的电脑推送目录快照（scripts/orca/sync-catalog.mjs）或管理员在设置页导入；proxy.ts 已放行 /api/im/webhooks，鉴权在 handleCatalogSync 内完成
export async function POST(req: NextRequest) {
  return handleCatalogSync(req, {
    client: db,
    session: async () => {
      const user = await getCurrentUser();
      return user ? { id: user.id, isAdmin: hasPermission(user.permissions, "admin") } : null;
    },
    onSaved: invalidateOrcaCatalogCache,
  });
}
