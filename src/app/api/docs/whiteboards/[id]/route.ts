import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { getDocAccess } from "@/lib/docs/access";
import { whiteboardUpdateSchema, WHITEBOARD_MAX_BYTES, type WhiteboardPayload } from "@/lib/docs/whiteboard/content";
import { getWhiteboardReferences, requireWhiteboardScene, WhiteboardError, writeWhiteboard } from "@/lib/docs/whiteboard/server";

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function boardAccess(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new WhiteboardError("未登录", 401);
  if (!(await isAppEnabled("docs"))) throw new WhiteboardError("「文档」应用已停用", 403);
  const result = await getDocAccess(user, id);
  if (!result?.canRead || result.doc.kind !== "whiteboard" || result.doc.deletedAt) {
    throw new WhiteboardError("白板不存在或没有访问权限", 404);
  }
  return { user, ...result };
}

function handleError(error: unknown) {
  if (error instanceof WhiteboardError) return errorResponse(error.message, error.status);
  console.error("[whiteboard-api]", error);
  return errorResponse("白板操作失败，请重试", 500);
}

export async function GET(_request: Request, ctx: RouteContext<"/api/docs/whiteboards/[id]">) {
  const { id } = await ctx.params;
  try {
    const { doc, user, canWrite } = await boardAccess(id);
    const scene = requireWhiteboardScene(doc.content);
    const references = await getWhiteboardReferences(user, scene.elements);
    return Response.json(
      { id, userId: user.id, title: doc.title, canWrite, scene, references } satisfies WhiteboardPayload,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/docs/whiteboards/[id]">) {
  const { id } = await ctx.params;
  try {
    const { user, doc, canWrite } = await boardAccess(id);
    if (!canWrite) return errorResponse("没有编辑该白板的权限", 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
      return errorResponse("请求格式不正确", 415);
    }
    if (Number(request.headers.get("Content-Length")) > WHITEBOARD_MAX_BYTES) {
      return errorResponse("白板内容超过 1 MB", 413);
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw) > WHITEBOARD_MAX_BYTES) return errorResponse("白板内容超过 1 MB", 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return errorResponse("请求格式不正确", 400);
    }
    const update = whiteboardUpdateSchema.safeParse(body);
    if (!update.success) return errorResponse("白板元素格式不正确或超出数量限制", 422);
    const revision = await writeWhiteboard(user, doc, update.data.expectedRevision, update.data.elements);
    return Response.json({ revision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
