import "server-only";
import { db, type DbClient } from "@/lib/db";
import { getDocAccess, visibleSpaceWhere, type DocUser } from "../access";
import { syncDocumentLinks } from "../links";
import {
  parseWhiteboard,
  whiteboardAttachmentIds,
  whiteboardLinkContent,
  whiteboardPageIds,
  whiteboardText,
  WHITEBOARD_MAX_BYTES,
  type WhiteboardElement,
  type WhiteboardScene,
} from "./content";

const VERSION_INTERVAL_MS = 10 * 60 * 1_000;

export class WhiteboardError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type BoardRecord = { id: string; spaceId: string; title: string; content: string };

export function requireWhiteboardScene(content: string): WhiteboardScene {
  const scene = parseWhiteboard(content);
  if (!scene) throw new WhiteboardError("白板内容无法读取", 422);
  return scene;
}

export async function getWhiteboardReferences(user: DocUser, items: WhiteboardElement[], client: DbClient = db) {
  const ids = whiteboardPageIds(items);
  if (!ids.length) return [];
  return client.document.findMany({
    where: { id: { in: ids }, deletedAt: null, isTemplate: false, space: visibleSpaceWhere(user) },
    select: { id: true, title: true, icon: true },
  });
}

async function validateNewReferences(
  tx: DbClient,
  user: DocUser,
  doc: BoardRecord,
  before: WhiteboardElement[],
  after: WhiteboardElement[],
) {
  const previousPages = new Set(whiteboardPageIds(before));
  const addedPages = whiteboardPageIds(after).filter((id) => !previousPages.has(id));
  if (addedPages.length) {
    const count = await tx.document.count({
      where: { id: { in: addedPages, not: doc.id }, deletedAt: null, isTemplate: false, space: visibleSpaceWhere(user) },
    });
    if (count !== addedPages.length) throw new WhiteboardError("引用的页面不存在或没有访问权限", 422);
  }

  const previousAttachments = new Set(whiteboardAttachmentIds(before));
  const addedAttachments = whiteboardAttachmentIds(after).filter((id) => !previousAttachments.has(id));
  if (addedAttachments.length) {
    const count = await tx.attachment.count({
      where: { id: { in: addedAttachments }, documentId: doc.id, spaceId: doc.spaceId, mediaType: { startsWith: "image/" } },
    });
    if (count !== addedAttachments.length) throw new WhiteboardError("图片不存在或不属于该白板", 422);
  }
}

export async function writeWhiteboard(
  user: DocUser,
  doc: BoardRecord,
  expectedRevision: number,
  items: WhiteboardElement[],
  restoreTitle?: string,
) {
  const previous = requireWhiteboardScene(doc.content);
  const conflict = () => new WhiteboardError("白板有更新，请载入最新版本。当前草稿仍可下载", 409);
  if (previous.revision !== expectedRevision) throw conflict();

  const scene: WhiteboardScene = { version: 1, revision: previous.revision + 1, elements: items };
  const content = JSON.stringify(scene);
  if (Buffer.byteLength(content) > WHITEBOARD_MAX_BYTES) throw new WhiteboardError("白板内容超过 1 MB", 413);
  const docText = whiteboardText(items);

  await db.$transaction(async (tx) => {
    const updated = await tx.document.updateMany({
      where: { id: doc.id, kind: "whiteboard", spaceId: doc.spaceId, content: doc.content, deletedAt: null },
      data: { content, text: docText, updatedById: user.id, ...(restoreTitle === undefined ? {} : { title: restoreTitle }) },
    });
    if (!updated.count) throw conflict();
    if (!(await getDocAccess(user, doc.id, tx))?.canWrite) throw new WhiteboardError("没有编辑该白板的权限", 403);

    // 恢复已授权读取的历史快照时，卡片继续按当前访问者权限解析。
    if (restoreTitle === undefined) await validateNewReferences(tx, user, doc, previous.elements, items);
    await syncDocumentLinks(tx, doc.id, whiteboardLinkContent(items), { isTemplate: false });

    if (restoreTitle !== undefined) {
      await tx.documentVersion.create({
        data: { documentId: doc.id, title: doc.title, content: doc.content, createdById: user.id },
      });
    } else {
      const last = await tx.documentVersion.findFirst({
        where: { documentId: doc.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!last || Date.now() - last.createdAt.getTime() >= VERSION_INTERVAL_MS) {
        await tx.documentVersion.create({
          data: { documentId: doc.id, title: doc.title, content, createdById: user.id },
        });
      }
    }
  });
  return scene.revision;
}
