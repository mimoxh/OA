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
]);

/** 提取纯文本（用于全文搜索、摘要） */
export function extractText(doc: JSONNode): string {
  const out: string[] = [];
  const walk = (n: JSONNode) => {
    if (n.type === "text" && n.text) out.push(n.text);
    else if (n.type === "mention") out.push(`@${String(n.attrs?.label ?? n.attrs?.id ?? "")}`);
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

function inlineMd(nodes: JSONNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "mention") return `@${String(n.attrs?.label ?? n.attrs?.id ?? "")}`;
      if (n.type === "image") return `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
      let t = n.text ?? "";
      const marks = n.marks ?? [];
      const has = (m: string) => marks.some((x) => x.type === m);
      if (has("code")) return "`" + t + "`";
      if (has("bold")) t = `**${t}**`;
      if (has("italic")) t = `*${t}*`;
      if (has("strike")) t = `~~${t}~~`;
      if (has("highlight")) t = `==${t}==`;
      if (has("underline")) t = `<u>${t}</u>`;
      const link = marks.find((m) => m.type === "link");
      if (link) t = `[${t}](${String(link.attrs?.href ?? "")})`;
      return t;
    })
    .join("");
}

function blockMd(n: JSONNode, indent = ""): string {
  switch (n.type) {
    case "paragraph":
      return indent + inlineMd(n.content);
    case "heading":
      return "#".repeat(Number(n.attrs?.level ?? 1)) + " " + inlineMd(n.content);
    case "blockquote":
      return (n.content ?? []).map((c) => blockMd(c)).join("\n\n").split("\n").map((l) => "> " + l).join("\n");
    case "callout":
      return (
        `> ${String(n.attrs?.emoji ?? "💡")} ` +
        (n.content ?? []).map((c) => blockMd(c)).join("\n\n").split("\n").join("\n> ")
      );
    case "codeBlock":
      return "```" + String(n.attrs?.language ?? "") + "\n" + (n.content ?? []).map((c) => c.text ?? "").join("") + "\n```";
    case "horizontalRule":
      return "---";
    case "image":
      return `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (n.content ?? [])
        .map((item, i) => {
          const marker =
            n.type === "orderedList" ? `${Number(n.attrs?.start ?? 1) + i}. ` : n.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] ` : "- ";
          const [first, ...rest] = item.content ?? [];
          const head = indent + marker + (first ? blockMd(first).trimStart() : "");
          const tail = rest.map((c) => blockMd(c, indent + "  ")).filter(Boolean);
          return [head, ...tail].join("\n");
        })
        .join("\n");
    case "table": {
      const rows = (n.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          (cell.content ?? []).map((p) => inlineMd(p.content)).join(" ").replace(/\|/g, "\\|"),
        ),
      );
      if (!rows.length) return "";
      const cols = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => "| " + Array.from({ length: cols }, (_, i) => r[i] ?? "").join(" | ") + " |";
      return [line(rows[0]), "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n");
    }
    default:
      return (n.content ?? []).map((c) => blockMd(c, indent)).join("\n\n");
  }
}

/** Tiptap JSON → Markdown */
export function toMarkdown(doc: JSONNode, title?: string): string {
  const body = (doc.content ?? []).map((n) => blockMd(n)).join("\n\n");
  return (title ? `# ${title}\n\n` : "") + body + "\n";
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
