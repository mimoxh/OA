import type { RefType } from "./types";

const MAX_TEXT = 5000;
const MAX_PARAGRAPHS = 200;
const MAX_LINKS = 3;

export type ParsedMessageContent = {
  /** 校验后的 Tiptap JSON 文档 */
  content: object;
  /** 纯文本（@提及 写作 @名字，段落间 \n） */
  text: string;
  /** 提及的用户 id（可含 "all"） */
  mentions: string[];
  /** 正文中的业务链接 */
  links: { type: RefType; id: string }[];
};

// 业务路由 → 引用类型（要求恰好一个 id 段；/new 等字面量与更深层级不算）
const REF_ROUTES: { pattern: RegExp; type: RefType }[] = [
  { pattern: /^\/docs\/([^/]+)$/, type: "document" },
  { pattern: /^\/oa\/approvals\/([^/]+)$/, type: "approval" },
  { pattern: /^\/crm\/customers\/([^/]+)$/, type: "customer" },
  { pattern: /^\/crm\/opportunities\/([^/]+)$/, type: "opportunity" },
  { pattern: /^\/erp\/sales\/([^/]+)$/, type: "sales" },
  { pattern: /^\/erp\/purchase\/([^/]+)$/, type: "purchase" },
  { pattern: /^\/pms\/projects\/([^/]+)$/, type: "project" },
  { pattern: /^\/tms\/orders\/([^/]+)$/, type: "transport" },
];
const RESERVED_SEGMENTS = new Set(["new", "trash", "edit"]);

function refForPath(pathname: string): { type: RefType; id: string } | null {
  for (const { pattern, type } of REF_ROUTES) {
    const m = pathname.match(pattern);
    if (m && m[1] && !RESERVED_SEGMENTS.has(m[1])) return { type, id: m[1] };
  }
  return null;
}

/** 从纯文本中提取业务引用：完整 URL 与站内 /path 均识别 */
export function extractLinks(text: string): { type: RefType; id: string }[] {
  const out: { type: RefType; id: string }[] = [];
  const seen = new Set<string>();
  const push = (r: { type: RefType; id: string } | null) => {
    if (!r || out.length >= MAX_LINKS) return;
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'）】]+/g)) {
    try {
      push(refForPath(new URL(m[0]).pathname));
    } catch {}
    if (out.length >= MAX_LINKS) return out;
  }
  for (const m of text.matchAll(/(?<![\w/])\/[\w\-/]+/g)) {
    push(refForPath(m[0].replace(/[.,;:!?]+$/g, "")));
    if (out.length >= MAX_LINKS) return out;
  }
  return out;
}

/**
 * 校验 TEXT 消息的 Tiptap 文档：doc > paragraph* > (text | hardBreak | mention)。
 * 不允许任何 marks。失败抛出中文错误。
 */
export function parseMessageContent(input: unknown): ParsedMessageContent {
  if (!input || typeof input !== "object" || (input as { type?: string }).type !== "doc") throw new Error("消息格式不正确");
  const content = input as { type: "doc"; content?: unknown };
  if (!Array.isArray(content.content)) throw new Error("消息格式不正确");
  if (content.content.length > MAX_PARAGRAPHS) throw new Error("消息过长");

  const parts: string[] = [];
  const mentionIds = new Set<string>();
  let textLen = 0;

  for (const para of content.content) {
    const p = para as { type?: string; content?: unknown; marks?: unknown };
    if (p.type !== "paragraph" || p.marks !== undefined) throw new Error("消息格式不正确");
    const line: string[] = [];
    if (Array.isArray(p.content)) {
      for (const node of p.content) {
        const n = node as { type?: string; text?: unknown; attrs?: { id?: unknown; label?: unknown }; marks?: unknown };
        if (n.marks !== undefined) throw new Error("消息格式不正确");
        if (n.type === "text") {
          if (typeof n.text !== "string") throw new Error("消息格式不正确");
          line.push(n.text);
          textLen += n.text.length;
        } else if (n.type === "hardBreak") {
          line.push("\n");
        } else if (n.type === "mention") {
          if (typeof n.attrs?.id !== "string" || !n.attrs.id) throw new Error("消息格式不正确");
          const label = typeof n.attrs.label === "string" && n.attrs.label ? n.attrs.label : "成员";
          line.push(`@${label}`);
          mentionIds.add(n.attrs.id);
        } else {
          throw new Error("消息格式不正确");
        }
      }
    }
    parts.push(line.join(""));
  }
  if (textLen > MAX_TEXT) throw new Error("消息不能超过 5000 字");

  const text = parts.join("\n");
  if (!text.trim() && mentionIds.size === 0) throw new Error("消息不能为空");
  return { content, text, mentions: [...mentionIds], links: extractLinks(text) };
}
