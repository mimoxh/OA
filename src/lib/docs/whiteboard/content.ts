import { z } from "zod";
import type { JSONNode } from "../content";

export const WHITEBOARD_ICON = "🎨";
export const WHITEBOARD_MAX_BYTES = 1024 * 1024;
export const WHITEBOARD_MAX_ELEMENTS = 2_000;
export const WHITEBOARD_MAX_POINTS = 1_200;
export const WHITEBOARD_MAX_COORDINATE = 1_000_000;
export const WHITEBOARD_COLORS = ["gray", "blue", "teal", "yellow", "pink", "purple"] as const;

const docId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const elementId = z.uuid();
const coordinate = z.number().min(-WHITEBOARD_MAX_COORDINATE).max(WHITEBOARD_MAX_COORDINATE);
const point = z.strictObject({ x: coordinate, y: coordinate });
const size = z.number().min(1).max(WHITEBOARD_MAX_COORDINATE);
const box = { id: elementId, x: coordinate, y: coordinate, width: size, height: size };
const color = z.enum(WHITEBOARD_COLORS);
const text = z.string().max(4_000).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/);
const endpoint = z.strictObject({ ...point.shape, elementId: elementId.optional() });
const normalizedPoint = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

const element = z.discriminatedUnion("type", [
  z.strictObject({
    ...box,
    type: z.enum(["rectangle", "ellipse", "diamond", "note", "text", "frame"]),
    text,
    color,
  }),
  z.strictObject({
    ...box,
    type: z.literal("pen"),
    points: z.array(normalizedPoint).min(1).max(WHITEBOARD_MAX_POINTS),
    color,
  }),
  z.strictObject({ id: elementId, type: z.literal("arrow"), from: endpoint, to: endpoint, text, color }),
  z.strictObject({ ...box, type: z.literal("page"), documentId: docId }),
  z.strictObject({ ...box, type: z.literal("image"), attachmentId: z.uuid() }),
]);

const elements = z.array(element).max(WHITEBOARD_MAX_ELEMENTS).superRefine((items, ctx) => {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    ctx.addIssue({ code: "custom", message: "画布元素 ID 重复" });
  }
});

const sceneSchema = z.strictObject({ version: z.literal(1), revision: z.number().int().nonnegative(), elements });

export const whiteboardUpdateSchema = z.strictObject({
  expectedRevision: sceneSchema.shape.revision,
  elements,
});

export type WhiteboardElement = z.infer<typeof element>;
export type WhiteboardScene = z.infer<typeof sceneSchema>;
export type WhiteboardColor = z.infer<typeof color>;
export type WhiteboardBox = Pick<Exclude<WhiteboardElement, { type: "arrow" }>, "x" | "y" | "width" | "height">;
export type WhiteboardPoint = z.infer<typeof point>;
export type WhiteboardReference = { id: string; title: string; icon: string | null };
export type WhiteboardPayload = {
  id: string;
  userId: string;
  title: string;
  canWrite: boolean;
  scene: WhiteboardScene;
  references: WhiteboardReference[];
};

export const EMPTY_WHITEBOARD = JSON.stringify({ version: 1, revision: 0, elements: [] } satisfies WhiteboardScene);

export function isWhiteboardDocumentId(value: unknown): value is string {
  return typeof value === "string" && docId.safeParse(value).success;
}

export function parseWhiteboard(content: string): WhiteboardScene | null {
  if (content.length > WHITEBOARD_MAX_BYTES) return null;
  try {
    const result = sceneSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function whiteboardText(items: WhiteboardElement[]) {
  return items.flatMap((item) => "text" in item && item.text.trim() ? [item.text.trim()] : []).join("\n");
}

export function whiteboardPageIds(items: WhiteboardElement[]) {
  return [...new Set(items.flatMap((item) => item.type === "page" ? [item.documentId] : []))];
}

export function whiteboardAttachmentIds(items: WhiteboardElement[]) {
  return [...new Set(items.flatMap((item) => item.type === "image" ? [item.attachmentId] : []))];
}

/** 与正文共用链接索引。卡片标题按访问者权限读取，不复制到白板正文或反链摘要。 */
export function whiteboardLinkContent(items: WhiteboardElement[]): JSONNode {
  return {
    type: "doc",
    content: items.flatMap((item) => item.type === "page" ? [{
      type: "paragraph",
      content: [{
        type: "text",
        text: "白板中的文档卡片",
        marks: [{ type: "link", attrs: { href: `/docs/${item.documentId}` } }],
      }],
    }] : []),
  };
}
