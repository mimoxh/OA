import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { getStorage, SAFE_INLINE_IMAGES } from "@/lib/storage";
import { fileExtension, MEDIA_MIME_BY_EXT } from "@/lib/file-preview/kinds";
import { rangeResponseInit } from "@/lib/file-preview/range";

/** 页内播放的音视频按真实类型返回（不是 HTML / SVG，nosniff 下不会被当成页面执行） */
const SAFE_INLINE_MEDIA = new Set(Object.values(MEDIA_MIME_BY_EXT));

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

  const forceDownload = req.nextUrl.searchParams.get("download") === "1";
  const declared = att.mimeType.split(";")[0].trim().toLowerCase();
  const media = SAFE_INLINE_MEDIA.has(declared) ? declared : MEDIA_MIME_BY_EXT[fileExtension(att.filename)];
  const inlineImage = SAFE_INLINE_IMAGES.has(att.mimeType);
  const inline = !forceDownload && (inlineImage || !!media);
  const encodedName = encodeURIComponent(att.filename);
  const contentType = !inline ? "application/octet-stream" : inlineImage ? att.mimeType : media!;
  const headers = {
    "Content-Type": contentType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=86400",
  };
  const rangeHeader = req.headers.get("range");
  const storage = getStorage();

  // 本地存储按 Range 只读需要的一段（音视频拖动进度、PDF 分段加载时不必每次整份读入内存）
  if (storage.readRange) {
    const holder: { init?: ReturnType<typeof rangeResponseInit> } = {};
    const got = await storage.readRange(att.key, (size) => {
      const init = rangeResponseInit(rangeHeader, size, headers);
      holder.init = init;
      if (init.status === 416 || size === 0) return null;
      return init.range ?? { start: 0, end: size - 1 };
    });
    if (!got || !holder.init) return NextResponse.json({ error: "文件内容已丢失" }, { status: 404 });
    const body = holder.init.status === 416 ? null : (got.data ?? new Uint8Array(0));
    return new NextResponse(body as Uint8Array<ArrayBuffer> | null, { status: holder.init.status, headers: holder.init.headers });
  }

  const obj = await storage.get(att.key);
  if (!obj) return NextResponse.json({ error: "文件内容已丢失" }, { status: 404 });
  const init = rangeResponseInit(rangeHeader, obj.data.byteLength, headers);
  const body =
    init.status === 416 ? null : init.range ? obj.data.subarray(init.range.start, init.range.end + 1) : obj.data;
  return new NextResponse(body as Uint8Array<ArrayBuffer> | null, {
    status: init.status,
    headers: init.headers,
  });
}
