import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { getStorage, SAFE_INLINE_IMAGES } from "@/lib/storage";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/im/files/[id]">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const att = await db.attachment.findUnique({ where: { id } });
  if (!att) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  // 访问控制：仅上传者或所属会话成员可访问
  if (att.uploaderId !== user.id) {
    if (!att.conversationId) return NextResponse.json({ error: "无权访问该文件" }, { status: 403 });
    const member = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: att.conversationId, userId: user.id } },
      select: { userId: true },
    });
    if (!member) return NextResponse.json({ error: "无权访问该文件" }, { status: 403 });
  }

  const obj = await getStorage().get(att.key);
  if (!obj) return NextResponse.json({ error: "文件内容已丢失" }, { status: 404 });

  const forceDownload = req.nextUrl.searchParams.get("download") === "1";
  const inline = !forceDownload && SAFE_INLINE_IMAGES.has(att.mimeType);
  const encodedName = encodeURIComponent(att.filename);
  const contentType = inline ? att.mimeType : "application/octet-stream";

  return new NextResponse(new Uint8Array(obj.data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(obj.data.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
