import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { getDocAccess } from "@/lib/docs/access";
import { parseContent, toMarkdown } from "@/lib/docs/content";

/** 以 Markdown 下载文档（服务端最近一次保存的内容） */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/docs/[id]/export">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const res = await getDocAccess(user, id);
  if (!res || !res.canRead) return NextResponse.json({ error: "没有权限访问该文档" }, { status: 403 });
  const title = res.doc.title || "无标题";
  const md = toMarkdown(parseContent(res.doc.content), title);
  const filename = encodeURIComponent(title.replace(/[\\/:*?"<>|]/g, "_")) + ".md";
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
    },
  });
}
