import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { visibleSpaceWhere } from "@/lib/docs/access";
import { hasPermission } from "@/lib/permissions";

/** 文档选择器（“链接到页面”）搜索 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });
  if (!(await isAppEnabled("docs"))) return NextResponse.json({ results: [] }, { status: 403 });
  if (!hasPermission(user.permissions, "docs:view")) return NextResponse.json({ results: [] }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const whiteboardsOnly = req.nextUrl.searchParams.get("kind") === "whiteboard";
  const rows = await db.document.findMany({
    where: {
      deletedAt: null,
      isTemplate: false,
      ...(whiteboardsOnly ? { kind: "whiteboard" } : {}),
      space: visibleSpaceWhere(user),
      ...(q ? { OR: [{ title: { contains: q } }, { text: { contains: q } }] } : {}),
    },
    select: {
      id: true,
      title: true,
      icon: true,
      kind: true,
      parent: { select: { title: true } },
      space: { select: { name: true, icon: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });
  return NextResponse.json({
    results: rows.map((d) => ({
      id: d.id,
      title: d.title || "无标题",
      icon: d.icon ?? (d.kind === "database" ? "🗃️" : "📄"),
      space:
        d.kind === "row" && d.parent
          ? `${d.space.icon} ${d.space.name} / ${d.parent.title || "多维表格"}`
          : `${d.space.icon} ${d.space.name}`,
    })),
  });
}
