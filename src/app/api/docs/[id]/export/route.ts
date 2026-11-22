import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { getDocAccess } from "@/lib/docs/access";
import { parseContent } from "@/lib/docs/content";
import { docToMarkdown } from "@/lib/docs/markdown";
import { buildDocsZip, collectAttachmentIds, safeFileName, ZipExportError, zipFileName, type ZipPage } from "@/lib/docs/export-zip";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** 下载文档 Markdown：无附件时为 .md，含附件或 ?subtree=1 时为 ZIP */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/docs/[id]/export">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return err("未登录", 401);
  const res = await getDocAccess(user, id);
  if (!res || !res.canRead) return err("没有权限访问该文档", 403);

  const subtree = req.nextUrl.searchParams.get("subtree") === "1";
  const json = parseContent(res.doc.content);
  const title = res.doc.title || "无标题";

  try {
    if (!subtree && collectAttachmentIds(json).size === 0) {
      const md = docToMarkdown(json, { title: res.doc.title, icon: res.doc.icon });
      return new NextResponse(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(title))}.md`,
          "Cache-Control": "no-store",
        },
      });
    }

    // 含附件或子树：打包 ZIP
    let pages: ZipPage[] = [res.doc];
    if (subtree) {
      const descendants = await db.document.findMany({
        where: { spaceId: res.doc.spaceId, deletedAt: null, isTemplate: false },
        select: { id: true, parentId: true, title: true, icon: true, content: true, sortOrder: true, createdAt: true },
      });
      const byParent = new Map<string | null, typeof descendants>();
      for (const d of descendants) {
        const key = d.parentId;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key)!.push(d);
      }
      for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
      const ordered: typeof descendants = [];
      const seen = new Set<string>([res.doc.id]);
      const walk = (pid: string) => {
        for (const c of byParent.get(pid) ?? []) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          ordered.push(c);
          walk(c.id);
        }
      };
      walk(res.doc.id);
      pages = [res.doc, ...ordered];
    }

    const zip = await buildDocsZip(res.doc.spaceId, pages, [res.doc.id]);
    return new NextResponse(zip as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${zipFileName(title)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ZipExportError) return err(e.message, e.status);
    throw e;
  }
}
