import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { getDocAccess } from "@/lib/docs/access";
import { attachmentUrl, ATTACHMENT_MAX_BYTES, sniffMediaType, storeAttachment } from "@/lib/docs/attachments";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

function isSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const source = new URL(origin);
    if (source.origin === req.nextUrl.origin) return true;
    // Next.js 开发服务器可能把回环地址规范化为 localhost。
    return source.protocol === req.nextUrl.protocol && source.host === req.headers.get("host")?.toLowerCase();
  } catch {
    return false;
  }
}

/** 上传附件（multipart：file + documentId），写入 storage 并登记 DocumentAttachment 记录 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return err("未登录", 401);
  if (!isSameOrigin(req)) return err("非法请求来源", 403);
  if (!(await isAppEnabled("docs"))) return err("「文档」应用已停用", 403);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > ATTACHMENT_MAX_BYTES + 64 * 1024) return err("文件超过 10MB 大小限制", 413);

  const form = await req.formData().catch(() => null);
  if (!form) return err("请求格式不正确", 400);
  const documentId = String(form.get("documentId") ?? "");
  const file = form.get("file");
  if (!documentId || !(file instanceof File)) return err("缺少文件或文档", 400);

  const access = await getDocAccess(user, documentId);
  if (!access?.canWrite) return err("没有权限访问该文档", 403);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) return err("文件超过 10MB 大小限制", 413);
  if (!sniffMediaType(bytes, file.name)) return err("不支持的文件类型", 415);

  const att = await storeAttachment({
    bytes,
    fileName: file.name,
    spaceId: access.doc.spaceId,
    documentId,
    userId: user.id,
  });
  return NextResponse.json({ id: att.id, url: attachmentUrl(att.id), fileName: att.fileName, mediaType: att.mediaType, size: att.size });
}
