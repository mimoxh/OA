export type JSONNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export const EMPTY_DOC: JSONNode = { type: "doc", content: [] };

export function parseContent(s: string | null | undefined): JSONNode {
  if (!s) return EMPTY_DOC;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && v.type === "doc" ? v : EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "codeBlock",
  "blockquote",
  "listItem",
  "taskItem",
  "tableRow",
  "callout",
  "horizontalRule",
  "fileAttachment",
]);

/** 提取纯文本（用于全文搜索、摘要） */
export function extractText(doc: JSONNode): string {
  const out: string[] = [];
  const walk = (n: JSONNode) => {
    if (n.type === "text" && n.text) out.push(n.text);
    else if (n.type === "mention") out.push(`@${String(n.attrs?.label ?? n.attrs?.id ?? "")}`);
    else if (n.type === "fileAttachment") out.push(`📎 ${String(n.attrs?.fileName ?? "附件")}`);
    else if (n.type === "hardBreak") out.push("\n");
    n.content?.forEach(walk);
    if (n.type === "tableCell" || n.type === "tableHeader") out.push(" ");
    if (n.type && BLOCKS.has(n.type)) out.push("\n");
  };
  walk(doc);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function isEmptyDoc(doc: JSONNode): boolean {
  const c = doc.content ?? [];
  if (c.length === 0) return true;
  return c.every((n) => n.type === "paragraph" && !(n.content && n.content.length));
}

/** 收集文档中出现的评论线程 id */
export function collectCommentIds(doc: JSONNode): string[] {
  const ids = new Set<string>();
  const walk = (n: JSONNode) => {
    n.marks?.forEach((m) => {
      if (m.type === "comment" && typeof m.attrs?.commentId === "string") ids.add(m.attrs.commentId);
    });
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...ids];
}

// ── JSON 构造工具（模板与种子数据共用） ──
export type Inline = string | JSONNode;
const inl = (items: Inline[]): JSONNode[] => {
  const out: JSONNode[] = [];
  for (const x of items) {
    if (x === "") continue;
    const prev = out[out.length - 1];
    if (typeof x === "string" && prev?.type === "text" && !prev.marks?.length) prev.text += x;
    else out.push(typeof x === "string" ? { type: "text", text: x } : x);
  }
  return out;
};

export const b = {
  doc: (...blocks: JSONNode[]): JSONNode => ({ type: "doc", content: blocks }),
  p: (...items: Inline[]): JSONNode => ({ type: "paragraph", content: inl(items) }),
  h: (level: 1 | 2 | 3, text: string): JSONNode => ({ type: "heading", attrs: { level }, content: inl([text]) }),
  text: (text: string, ...marks: (string | { type: string; attrs?: Record<string, unknown> })[]): JSONNode => ({
    type: "text",
    text,
    marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)),
  }),
  ul: (...items: (string | JSONNode[])[]): JSONNode => ({
    type: "bulletList",
    content: items.map((t) => ({ type: "listItem", content: typeof t === "string" ? [b.p(t)] : t })),
  }),
  ol: (...items: string[]): JSONNode => ({
    type: "orderedList",
    attrs: { start: 1 },
    content: items.map((t) => ({ type: "listItem", content: [b.p(t)] })),
  }),
  todo: (...items: [string, boolean][]): JSONNode => ({
    type: "taskList",
    content: items.map(([t, checked]) => ({ type: "taskItem", attrs: { checked }, content: [b.p(t)] })),
  }),
  quote: (...items: Inline[]): JSONNode => ({ type: "blockquote", content: [b.p(...items)] }),
  callout: (emoji: string, ...items: Inline[]): JSONNode => ({ type: "callout", attrs: { emoji }, content: [b.p(...items)] }),
  code: (language: string, code: string): JSONNode => ({ type: "codeBlock", attrs: { language }, content: [{ type: "text", text: code }] }),
  hr: (): JSONNode => ({ type: "horizontalRule" }),
  mention: (id: string, label: string): JSONNode => ({ type: "mention", attrs: { id, label } }),
  table: (header: string[], ...rows: string[][]): JSONNode => ({
    type: "table",
    content: [
      { type: "tableRow", content: header.map((c) => ({ type: "tableHeader", content: [b.p(c)] })) },
      ...rows.map((r) => ({ type: "tableRow", content: r.map((c) => ({ type: "tableCell", content: [b.p(c)] })) })),
    ],
  }),
};
