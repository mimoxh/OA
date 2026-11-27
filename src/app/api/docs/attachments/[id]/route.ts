import { open } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { getSpaceAccess } from "@/lib/docs/access";
import { attachmentPath, ATTACHMENT_ID_RE } from "@/lib/docs/attachments";
import { rangeResponseInit } from "@/lib/file-preview/range";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** 下载 / 预览附件：空间可见成员可读 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/docs/attachments/[id]">) {
  const user = await getCurrentUser();
  if (!user) return err("未登录", 401);
  const { id } = await ctx.params;
  if (!ATTACHMENT_ID_RE.test(id) || !(await isAppEnabled("docs"))) return err("附件不存在", 404);

  const att = await db.documentAttachment.findUnique({ where: { id } });
  if (!att) return err("附件不存在", 404);
  const space = await getSpaceAccess(user, att.spaceId);
  if (!space?.access.canView) return err("附件不存在", 404);

  const baseType = att.mediaType.split(";")[0].trim().toLowerCase();
  // SVG 能带脚本：只作为下载返回（octet-stream），页内预览时由前端当作 <img> 显示
  const svg = baseType === "image/svg+xml";
  const canInline =
    !svg && (baseType.startsWith("image/") || baseType.startsWith("video/") || baseType.startsWith("audio/") || baseType === "application/pdf");
  const download = req.nextUrl.searchParams.get("download") === "1";
  const disposition = `${canInline && !download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`;

  // 按 Range 只读需要的那一段（预览大文件 / 压缩包目录时不必整份读进内存）
  let file;
  try {
    file = await open(attachmentPath(att.id), "r");
  } catch {
    return err("附件文件缺失", 503);
  }
  try {
    const { size } = await file.stat();
    const init = rangeResponseInit(req.headers.get("range"), size, {
      "Content-Type": svg ? "application/octet-stream" : att.mediaType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": disposition,
    });
    let body: Uint8Array | null = null;
    if (init.status !== 416) {
      const start = init.range?.start ?? 0;
      const length = init.range ? init.range.end - start + 1 : size;
      body = new Uint8Array(length);
      let off = 0;
      while (off < length) {
        const { bytesRead } = await file.read(body, off, length - off, start + off);
        if (!bytesRead) break;
        off += bytesRead;
      }
      if (off < length) body = body.subarray(0, off);
    }
    return new NextResponse(body as Uint8Array<ArrayBuffer> | null, { status: init.status, headers: init.headers });
  } finally {
    await file.close();
  }
}
