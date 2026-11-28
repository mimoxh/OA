import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getOrcaCatalog } from "@/lib/im/orca-catalog-service";

/**
 * 只读：Orca 的基座、真实模型与 Effort 目录，供聊天页运行配置条与 Webhook 机器人设置页使用。
 * 来源优先级：本机 Orca → 已同步快照（NAS / 容器部署）→ 静态预设，均合并手动维护的自定义模型（origin 字段标明来源）。
 * 服务端缓存 60 秒；?refresh=1 强制重新发现。发现失败时返回静态预设与 warnings，而不是错误。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const catalog = await getOrcaCatalog({ refresh });
  return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
}
