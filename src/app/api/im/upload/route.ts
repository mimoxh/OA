import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { requireMember } from "@/lib/im/service";
import { detectSafeImageMime, getStorage, makeStorageKey, sanitizeFilename } from "@/lib/storage";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function parseDim(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "上传请求格式不正确" }, { status: 400 });
  }

  const file = form.get("file");
  const conversationId = typeof form.get("conversationId") === "string" ? String(form.get("conversationId")).trim() : "";
  if (!(file instanceof File) || !conversationId) {
    return NextResponse.json({ error: "缺少文件或会话参数" }, { status: 400 });
  }

  const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { type: true } });
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (conv.type === "BOT") return NextResponse.json({ error: "机器人会话不支持上传附件" }, { status: 400 });
  try {
    await requireMember(db, conversationId, user.id);
  } catch {
    return NextResponse.json({ error: "你不在该会话中" }, { status: 403 });
  }

  if (file.size <= 0) return NextResponse.json({ error: "不能上传空文件" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "文件大小不能超过 25 MB" }, { status: 413 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const detectedImage = detectSafeImageMime(buf);
  const isImage = !!detectedImage && file.type.startsWith("image/");
  if (isImage && buf.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "图片大小不能超过 10 MB" }, { status: 413 });
  }

  const filename = sanitizeFilename(file.name);
  const mimeType = isImage ? detectedImage : (file.type || "application/octet-stream").slice(0, 120);
  const key = makeStorageKey("im", filename);

  await getStorage().put(key, buf, mimeType);
  const att = await db.attachment.create({
    data: {
      key,
      filename,
      mimeType,
      size: buf.byteLength,
      width: isImage ? parseDim(form.get("width")) : null,
      height: isImage ? parseDim(form.get("height")) : null,
      uploaderId: user.id,
      conversationId,
    },
  });

  return NextResponse.json({
    id: att.id,
    url: `/api/im/files/${att.id}`,
    filename: att.filename,
    mimeType: att.mimeType,
    size: att.size,
    width: att.width,
    height: att.height,
    kind: isImage ? "image" : "file",
  });
}
