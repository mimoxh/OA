import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { getDocAccess } from "@/lib/docs/access";
import { queryBacklinks } from "@/lib/docs/links";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** 查询指向当前文档的反向链接（仅返回当前用户可见、未删除的非模板源文档） */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/docs/[id]/backlinks">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return err("未登录", 401);
  if (!(await isAppEnabled("docs"))) return err("「文档」应用已停用", 403);

  const res = await getDocAccess(user, id);
  if (!res || !res.canRead) return err("没有权限访问该文档", 403);
  if (res.doc.deletedAt) return err("文档已在回收站中", 404);

  const data = await queryBacklinks(user, id);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
