import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { getSpaceAccess } from "@/lib/docs/access";
import { buildDocsZip, ZipExportError, zipFileName } from "@/lib/docs/export-zip";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** 打包导出整个空间为 ZIP（pages/ + attachments/ + manifest.json） */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/docs/spaces/[id]/export">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return err("未登录", 401);
  if (!(await isAppEnabled("docs"))) return err("「文档」应用已停用", 403);
  const res = await getSpaceAccess(user, id);
  if (!res || !res.access.canView) return err("没有权限访问该空间", 403);

  const pages = await db.document.findMany({
    where: { spaceId: id, deletedAt: null, isTemplate: false },
    select: { id: true, parentId: true, title: true, icon: true, content: true, sortOrder: true, createdAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  try {
    const ids = new Set(pages.map((p) => p.id));
    const zip = await buildDocsZip(id, pages, pages.filter((p) => !p.parentId || !ids.has(p.parentId)).map((p) => p.id));
    return new NextResponse(zip as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${zipFileName(res.space.name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ZipExportError) return err(e.message, e.status);
    throw e;
  }
}
