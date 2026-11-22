import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { getSpaceAccess } from "@/lib/docs/access";
import { attachmentPath, ATTACHMENT_ID_RE } from "@/lib/docs/attachments";

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

  let data: Buffer;
  try {
    data = await readFile(attachmentPath(att.id));
  } catch {
    return err("附件文件缺失", 503);
  }

  const baseType = att.mediaType.split(";")[0].trim();
  const canInline = baseType.startsWith("image/") || baseType === "application/pdf";
  const download = req.nextUrl.searchParams.get("download") === "1";
  const disposition = `${canInline && !download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": att.mediaType,
      "Content-Length": String(data.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": disposition,
    },
  });
}
