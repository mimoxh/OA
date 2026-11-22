import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server, type Hocuspocus } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror";
import * as Y from "yjs";
import { db } from "@/lib/db";
import { verifyScopedToken } from "@/lib/auth/token";
import { getDocAccess, loadDocUser } from "@/lib/docs/access";
import { COLLAB_FIELD, createSchemaExtensions } from "@/lib/docs/schema";
import { extractText, parseContent } from "@/lib/docs/content";

const PORT = Number(process.env.COLLAB_PORT ?? 1234);
/** 编辑过程中距上一个历史版本超过该时长时自动生成新版本 */
const VERSION_INTERVAL_MS = 10 * 60 * 1000;
const STATELESS_TYPES = new Set(["title", "comments", "meta", "restored", "trashed"]);

const extensions = createSchemaExtensions();
const schema = getSchema(extensions);

type Context = { userId?: string; name?: string };

function log(...args: unknown[]) {
  console.log(`[collab ${new Date().toLocaleTimeString()}]`, ...args);
}

async function persist(document: Y.Doc, documentId: string, userId?: string) {
  const existing = await db.document.findUnique({
    where: { id: documentId },
    select: { content: true, title: true, createdById: true, updatedAt: true },
  });
  if (!existing) return;
  const json = TiptapTransformer.fromYdoc(document, COLLAB_FIELD);
  const content = JSON.stringify(json);
  const state = Buffer.from(Y.encodeStateAsUpdate(document));
  if (content === existing.content) {
    await db.document.update({ where: { id: documentId }, data: { ydoc: state, updatedAt: existing.updatedAt } });
    return;
  }
  await db.document.update({
    where: { id: documentId },
    data: { ydoc: state, content, text: extractText(json), ...(userId ? { updatedById: userId } : {}) },
  });
  const last = await db.documentVersion.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!last || Date.now() - last.createdAt.getTime() > VERSION_INTERVAL_MS) {
    await db.documentVersion.create({
      data: { documentId, title: existing.title, content, createdById: userId ?? existing.createdById },
    });
    log("auto version", documentId);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function authorize(token: unknown, documentId: unknown) {
  if (typeof token !== "string" || typeof documentId !== "string") throw new HttpError(400, "参数错误");
  const session = await verifyScopedToken(token, "collab");
  if (!session?.userId) throw new HttpError(401, "未登录");
  const user = await loadDocUser(session.userId);
  if (!user) throw new HttpError(401, "用户不存在或已停用");
  const res = await getDocAccess(user, documentId);
  if (!res || !res.canRead) throw new HttpError(403, "没有权限访问该文档");
  return { user, ...res };
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 恢复历史版本：在协同文档内以普通 Yjs 事务写入，所有在线客户端都会收到这次修改，且旧状态无法再被合并回来 */
async function restoreVersion(instance: Hocuspocus, body: Record<string, unknown>) {
  const { user, doc, canWrite } = await authorize(body.token, body.documentId);
  if (!canWrite) throw new HttpError(403, "没有编辑权限");
  const version = await db.documentVersion.findUnique({ where: { id: String(body.versionId ?? "") } });
  if (!version || version.documentId !== doc.id) throw new HttpError(404, "版本不存在");

  const conn = await instance.openDirectConnection(doc.id, { userId: user.id, name: user.name } satisfies Context);
  try {
    const live = conn.document;
    if (!live) throw new HttpError(500, "文档加载失败");
    const currentJson = TiptapTransformer.fromYdoc(live, COLLAB_FIELD);
    const current = JSON.stringify(currentJson);
    if (current !== version.content) {
      await db.documentVersion.create({
        data: { documentId: doc.id, title: doc.title, content: current, createdById: user.id },
      });
    }
    await conn.transact((d) => {
      prosemirrorJSONToYXmlFragment(schema, parseContent(version.content), d.getXmlFragment(COLLAB_FIELD));
    });
    await db.document.update({ where: { id: doc.id }, data: { title: version.title, updatedById: user.id } });
    live.broadcastStateless(JSON.stringify({ type: "restored", title: version.title, by: user.name }));
  } finally {
    await conn.disconnect();
  }
  log("restored", doc.id, "->", version.id, "by", user.name);
  return { ok: true };
}

/** Next 服务端动作（重命名、移入回收站等）通知在线客户端 */
async function broadcast(instance: Hocuspocus, body: Record<string, unknown>) {
  await authorize(body.token, body.documentId);
  const payload = body.payload as { type?: string } | undefined;
  if (!payload || !STATELESS_TYPES.has(String(payload.type))) throw new HttpError(400, "不支持的消息");
  const live = instance.documents.get(String(body.documentId));
  live?.broadcastStateless(JSON.stringify(payload));
  return { ok: true, delivered: !!live };
}

const server = new Server<Context>({
  name: "oa-docs",
  port: PORT,
  quiet: true,
  debounce: 1500,
  maxDebounce: 8000,

  async onListen() {
    log(`Hocuspocus 协同服务已启动 ws://localhost:${PORT}`);
  },

  async onAuthenticate({ token, documentName, connectionConfig }) {
    const session = await verifyScopedToken(token, "collab");
    if (!session?.userId) throw new Error("未登录或登录已过期");
    const user = await loadDocUser(session.userId);
    if (!user) throw new Error("用户不存在或已停用");
    const res = await getDocAccess(user, documentName);
    if (!res || !res.canRead) throw new Error("没有权限访问该文档");
    if (!res.canWrite) connectionConfig.readOnly = true;
    return { userId: user.id, name: user.name } satisfies Context;
  },

  async onLoadDocument({ documentName }) {
    const doc = await db.document.findUnique({ where: { id: documentName }, select: { ydoc: true, content: true } });
    if (!doc) throw new Error("文档不存在");
    if (doc.ydoc && doc.ydoc.length > 0) return new Uint8Array(doc.ydoc);
    const json = parseContent(doc.content);
    if (!json.content?.length) return;
    return TiptapTransformer.toYdoc(json, COLLAB_FIELD, extensions);
  },

  async onStoreDocument({ document, documentName, lastContext }) {
    await persist(document, documentName, lastContext?.userId);
  },

  async onStateless({ payload, document, connection }) {
    let msg: { type?: string };
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (!STATELESS_TYPES.has(String(msg.type))) return;
    if ((msg.type === "title" || msg.type === "meta") && connection.readOnly) return;
    document.broadcastStateless(payload, (c) => c !== connection);
  },

  async onRequest({ request, response, instance }) {
    const url = request.url ?? "/";
    if (request.method === "GET" && url.startsWith("/health")) {
      sendJson(response, 200, { ok: true, documents: instance.getDocumentsCount(), connections: instance.getConnectionsCount() });
      throw null;
    }
    if (request.method !== "POST" || !(url.startsWith("/restore") || url.startsWith("/broadcast"))) return;
    try {
      const body = JSON.parse((await readBody(request)) || "{}");
      const result = url.startsWith("/restore") ? await restoreVersion(instance, body) : await broadcast(instance, body);
      sendJson(response, 200, result);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      sendJson(response, status, { ok: false, error: e instanceof Error ? e.message : "操作失败" });
    }
    // 阻止 Hocuspocus 默认的 HTTP 响应
    throw null;
  },
});

server.listen();
