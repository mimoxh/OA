import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { getSpaceAccess } from "@/lib/docs/access";
import { queryGraphData } from "@/lib/docs/links";
import { hasPermission } from "@/lib/permissions";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** 获取当前用户可见文档的关系图节点与聚合边（可选 ?spaceId=... 过滤单空间） */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return err("未登录", 401);
  if (!(await isAppEnabled("docs"))) return err("「文档」应用已停用", 403);
  if (!hasPermission(user.permissions, "docs:view")) return err("没有访问文档的权限", 403);

  const rawSpaceId = req.nextUrl.searchParams.get("spaceId")?.trim() || null;
  if (rawSpaceId) {
    const res = await getSpaceAccess(user, rawSpaceId);
    if (!res || !res.access.canView) return err("空间不存在或没有访问权限", 403);
  }

  const data = await queryGraphData(user, rawSpaceId);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
