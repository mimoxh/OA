import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getOrcaCatalog } from "@/lib/im/orca-catalog";

/**
 * 只读：同机 Orca 的基座、真实模型与 Effort 目录，供聊天页运行配置条与 Webhook 机器人设置页使用。
 * 服务端缓存 60 秒；?refresh=1 强制重新发现。发现失败时返回静态预设与 warnings，而不是错误。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const catalog = await getOrcaCatalog({ refresh });
  return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
}
