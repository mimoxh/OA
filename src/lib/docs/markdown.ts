import { flattenExtensions, getSchema, type AnyExtension, type MarkdownLexerConfiguration, type MarkdownToken } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { MarkdownManager } from "@tiptap/markdown";
import { Callout, createSchemaExtensions, FileAttachment } from "./schema";
import type { JSONNode } from "./content";

/** 提示块 emoji ↔ GitHub alert 类型 */
const EMOJI_TO_TYPE: Record<string, string> = { "💡": "TIP", "ℹ️": "NOTE", "⚠️": "WARNING", "❗": "IMPORTANT", "⛔": "CAUTION", "🚫": "CAUTION" };
const TYPE_TO_EMOJI: Record<string, string> = { NOTE: "ℹ️", TIP: "💡", IMPORTANT: "❗", WARNING: "⚠️", CAUTION: "⛔" };
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
// 第一个“字素簇”级别的 emoji 开头（含 VS16/ZWJ/肤色组合）
const EMOJI_START = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F?|[\u{1F3FB}-\u{1F3FF}]|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0F?)*/u;

const ATTACHMENT_URL_RE = /^\/api\/docs\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\?download=1)?$/i;
const DOC_URL_RE = /^\/docs\/([\w-]+)$/;

const escapeLinkLabel = (s: string) => s.replace(/([\\[\]])/g, "\\$1");

export type AttachmentInfo = { id: string; fileName?: string; mediaType?: string; size?: number };
/** 导出时把站内引用改写成目标链接（ZIP 内相对路径等）；返回 null 表示保持原样 */
export type ExportResolvers = {
  resolveAttachment?: (a: AttachmentInfo) => string | null;
  resolveDocLink?: (docId: string) => string | null;
};

/** markdown 专用的扩展副本：仅补渲染/解析规格，不改共享 schema（协同端仍用原始列表） */
function markdownExtensions(resolveAttachment?: ExportResolvers["resolveAttachment"]): AnyExtension[] {
  const calloutMd = Callout.extend({
    renderMarkdown(node, h) {
      const emoji = typeof node.attrs?.emoji === "string" ? node.attrs.emoji : "💡";
      const type = EMOJI_TO_TYPE[emoji] ?? "NOTE";
      const body = h.renderChildren((node.content ?? []) as never, "\n\n");
      const lines = body ? body.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")) : [];
      return [`> [!${type}] ${emoji}`, ...lines].join("\n");
    },
  });
  const attachmentMd = FileAttachment.extend({
    renderMarkdown(node) {
      const a = node.attrs ?? {};
      const name = escapeLinkLabel(String(a.fileName ?? "附件"));
      const target =
        resolveAttachment?.({
          id: String(a.id ?? ""),
          fileName: String(a.fileName ?? ""),
          mediaType: String(a.mediaType ?? ""),
          size: Number(a.size ?? 0),
        }) ?? `/api/docs/attachments/${String(a.id)}?download=1`;
      return `[${name}](${target})`;
    },
  });
  // flatten 后才能拿到 StarterKit 内部的 heading/underline 等扩展副本；
  // kit 容器自身必须剔除（manager 会再 flatten 一次，listItem/taskItem 的子 keymap 同理）
  return flattenExtensions(createSchemaExtensions())
    .filter((e) => e.name !== "starterKit" && e.name !== "tableKit" && e.name !== "listItemBranchingDeleteKeymap" && e.name !== "taskItemBranchingDeleteKeymap")
    .map((e) => {
      if (e.name === "callout") return calloutMd;
      if (e.name === "fileAttachment") return attachmentMd;
      if (e.name === "mention")
        return e.extend({
          renderMarkdown: (node) => `@${String(node.attrs?.label ?? node.attrs?.id ?? "")}`,
        });
      if (e.name === "heading")
        // 内置规格把超出 levels 的标题降级为段落；这里改为截断到最大级别
        return e.extend({
          parseMarkdown(token, h) {
            const levels = (e.options.levels as number[] | undefined) ?? [1, 2, 3];
            const depth = Number(token.depth) || 1;
            const level = levels.includes(depth) ? depth : Math.max(...levels);
            return h.createNode("heading", { level }, h.parseInline(token.tokens ?? []));
          },
        });
      if (e.name === "underline")
        // 内置 tokenizer 大小写不敏感；这里只认精确的 <u>…</u>
        return e.extend({
          markdownTokenizer: {
            name: "underline",
            level: "inline",
            start: (src: string) => src.indexOf("<u>"),
            tokenize(src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
              if (!src.startsWith("<u>")) return;
              const delimiters = /\\[\s\S]|`+|<\/u>/g;
              delimiters.lastIndex = 3;
              let match = delimiters.exec(src);
              while (match) {
                if (match[0].startsWith("`")) {
                  const codeSpan = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.exec(src.slice(match.index));
                  if (codeSpan) delimiters.lastIndex = match.index + codeSpan[0].length;
                } else if (!match[0].startsWith("\\")) {
                  const text = src.slice(3, match.index);
                  if (!text) return;
                  return {
                    type: "underline",
                    raw: src.slice(0, delimiters.lastIndex),
                    text,
                    tokens: lexer.inlineTokens(text),
                  };
                }
                match = delimiters.exec(src);
              }
            },
          },
        });
      return e;
    });
}

function createManager(resolveAttachment?: ExportResolvers["resolveAttachment"]) {
  return new MarkdownManager({ extensions: markdownExtensions(resolveAttachment) });
}

/** 导出前遍历 JSON：重写文档内链与内部图片地址 */
function transformForExport(doc: JSONNode, resolvers: ExportResolvers): JSONNode {
  const walk = (n: JSONNode): JSONNode => {
    const out: JSONNode = { ...n };
    if (out.type === "image" && typeof out.attrs?.src === "string") {
      const m = ATTACHMENT_URL_RE.exec(out.attrs.src);
      if (m) {
        const target = resolvers.resolveAttachment?.({ id: m[1] });
        if (target) out.attrs = { ...out.attrs, src: target };
      }
    }
    if (out.marks) {
      out.marks = out.marks.map((mark) => {
        if (mark.type !== "link" || typeof mark.attrs?.href !== "string") return mark;
        const m = DOC_URL_RE.exec(mark.attrs.href);
        if (!m) return mark;
        const target = resolvers.resolveDocLink?.(m[1]);
        return target ? { ...mark, attrs: { ...mark.attrs, href: target } } : mark;
      });
    }
    if (out.content) out.content = out.content.map(walk);
    return out;
  };
  return walk(doc);
}

const q = (v: string) => JSON.stringify(v);

/** Tiptap JSON → Markdown（含 front matter 元数据；正文不重复标题） */
export function docToMarkdown(
  doc: JSONNode,
  opts: { title?: string | null; icon?: string | null } & ExportResolvers = {},
): string {
  const fm = [`---`, `title: ${q(opts.title ?? "")}`, ...(opts.icon ? [`icon: ${q(opts.icon)}`] : []), `---`, ``].join("\n");
  const body = createManager(opts.resolveAttachment).serialize(transformForExport(doc, opts)).trim();
  return fm + "\n" + body + "\n";
}

// ───────────── 导入 ─────────────

type FrontMatter = { title?: string; icon?: string; ignored: string[] };

function parseScalar(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (s.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(s);
      return typeof v === "string" ? v : undefined;
    } catch {
      return undefined;
    }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** 解析文件开头的 --- front matter（仅取 title/icon，其余键忽略并记录；正文分隔线不误判） */
function splitFrontMatter(src: string): { meta: FrontMatter; body: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { meta: { ignored: [] }, body: src };
  const lines = m[1].split(/\r?\n/);
  const meta: FrontMatter = { ignored: [] };
  let kvCount = 0;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([-\w]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      kvCount += 1;
      const key = kv[1].toLowerCase();
      const value = parseScalar(kv[2]);
      if (key === "title" && value !== undefined) meta.title = value.slice(0, 200);
      else if (key === "icon" && value !== undefined) meta.icon = value.slice(0, 16);
      else if (key !== "title" && key !== "icon") meta.ignored.push(kv[1]);
      continue;
    }
    // 允许缩进续行（如 YAML 列表项 `  - tag`）；非缩进正文说明不是 front matter
    if (/^\s+\S/.test(line) && kvCount > 0) continue;
    return { meta: { ignored: [] }, body: src };
  }
  if (kvCount === 0) return { meta: { ignored: [] }, body: src };
  return { meta, body: src.slice(m[0].length) };
}

/** 把段落内联节点按 \n / hardBreak 切成行 */
function inlineLines(content: JSONNode[]): JSONNode[][] {
  const lines: JSONNode[][] = [[]];
  for (const node of content) {
    if (node.type === "hardBreak") {
      lines.push([]);
      continue;
    }
    if (node.type === "text" && typeof node.text === "string" && node.text.includes("\n")) {
      const parts = node.text.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) lines.push([]);
        if (p) lines[lines.length - 1].push({ ...node, text: p });
      });
      continue;
    }
    lines[lines.length - 1].push(node);
  }
  return lines;
}

const lineText = (nodes: JSONNode[]): string =>
  nodes.map((n) => (n.type === "text" ? (n.text ?? "") : n.type === "mention" ? `@${String(n.attrs?.label ?? "")}` : "")).join("");

/** 块节点摊平为段落（保留其内联内容；代码块、图片与列表项逐条成段） */
function flattenToParagraphs(node: JSONNode): JSONNode[] {
  if (node.type === "paragraph") return [node];
  if (node.type === "heading") return [{ type: "paragraph", content: node.content ?? [] }];
  if (node.type === "image") return [{ type: "paragraph", content: [node] }];
  if (node.type === "codeBlock") {
    const code = (node.content ?? []).map((c) => c.text ?? "").join("");
    if (!code) return [];
    return code
      .split("\n")
      .map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line, marks: [{ type: "code" }] }] } : { type: "paragraph" }));
  }
  return (node.content ?? []).flatMap((c) => flattenToParagraphs(c));
}

/** `> [!TYPE] emoji/标题` 引用块 → callout */
function transformAlert(block: JSONNode): JSONNode {
  const first = block.content?.[0];
  if (!first || first.type !== "paragraph" || !first.content?.length) return block;
  const t0 = first.content[0];
  if (t0.type !== "text" || typeof t0.text !== "string") return block;
  const m = ALERT_RE.exec(t0.text);
  if (!m) return block;
  const type = m[1].toUpperCase();

  const lines = inlineLines(first.content);
  const restLine = [...lines[0]];
  restLine[0] = { ...(restLine[0] as JSONNode), text: (restLine[0] as JSONNode).text!.slice(m[0].length) };
  let rest = lineText(restLine).replace(/^\s+/, "");

  let emoji = TYPE_TO_EMOJI[type] ?? "💡";
  const em = EMOJI_START.exec(rest);
  if (em) {
    emoji = em[0];
    rest = rest.slice(em[0].length).replace(/^\s+/, "");
  }

  const body: JSONNode[] = [];
  if (rest) body.push({ type: "paragraph", content: [{ type: "text", text: rest, marks: [{ type: "bold" }] }] });
  const tailLines = lines.slice(1).flat();
  if (tailLines.length && lineText(tailLines).trim()) body.push({ type: "paragraph", content: tailLines });
  for (const b of (block.content ?? []).slice(1)) body.push(...flattenToParagraphs(b));
  if (!body.length) body.push({ type: "paragraph" });
  return { type: "callout", attrs: { emoji }, content: body };
}

/** 递归把匹配 [!TYPE] 的引用块转成 callout */
function transformCallouts(node: JSONNode): JSONNode {
  const out = { ...node };
  if (out.content) {
    out.content = out.content.map((c) => (c.type === "blockquote" ? transformAlert(c) : transformCallouts(c)));
  }
  return out;
}

function clampHeadings(node: JSONNode): JSONNode {
  const out = { ...node };
  if (out.type === "heading" && Number(out.attrs?.level) > 3) out.attrs = { ...out.attrs, level: 3 };
  if (out.content) out.content = out.content.map(clampHeadings);
  return out;
}

export type ParsedMarkdown = {
  title: string | undefined;
  icon: string | undefined;
  json: JSONNode;
  ignoredMeta: string[];
  warnings: string[];
};

/** Markdown 源码 → Tiptap JSON（front matter、GitHub alert、H1 标题回退） */
export function markdownToDoc(md: string, ctx: { fileName?: string } = {}): ParsedMarkdown {
  const warnings: string[] = [];
  const src = md.replace(/^\uFEFF/, "");
  const { meta, body } = splitFrontMatter(src);
  const json = clampHeadings(transformCallouts(createManager().parse(body) as JSONNode));

  let title = meta.title;
  const blocks = json.content ?? [];
  if (title === undefined && blocks[0]?.type === "heading" && Number(blocks[0].attrs?.level) === 1) {
    title = lineText(blocks[0].content ?? []) || undefined;
    blocks.shift();
    // 删掉标题后面的首个空段落（H1 与正文之间的空行）
    const first: JSONNode | undefined = blocks[0];
    if (first?.type === "paragraph" && !(first.content?.length)) blocks.shift();
  }
  if (title === undefined && ctx.fileName) title = ctx.fileName.replace(/\.(?:md|markdown|txt)$/i, "");
  if (!json.content?.length) json.content = [{ type: "paragraph" }];
  return { title, icon: meta.icon, json, ignoredMeta: meta.ignored, warnings };
}

// ───────────── 引用解析与消毒 ─────────────

export type ResolvedRef =
  | { kind: "keep"; href?: string }
  | { kind: "attachment"; attachment: AttachmentInfo }
  | { kind: "doc"; docId: string }
  | { kind: "drop"; reason: string };

export type ImportResolvers = {
  /** 相对路径引用（相对所在 md 文件目录解析后的原始 href）→ 目标 */
  resolveLocal?: (href: string) => ResolvedRef;
  /** `/docs/<id>` 目标存在且可读 */
  checkDocLink?: (docId: string) => boolean;
  /** `/api/docs/attachments/<id>` 属于目标空间时返回附件信息，否则 null */
  checkAttachment?: (id: string) => AttachmentInfo | null;
};

const BAD_HREF_RE = /[\\\x00-\x1f\x7f]/;

/** 链接目标分类：允许 http(s)/mailto/锚点/站内文档与附件/相对路径，其余丢弃 */
function classifyHref(href: string, resolvers: ImportResolvers): ResolvedRef {
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return { kind: "keep" };
  if (href.startsWith("#")) return { kind: "keep" };
  if (BAD_HREF_RE.test(href) || href.startsWith("//")) return { kind: "drop", reason: `链接目标不安全：${href.slice(0, 60)}` };
  const docM = DOC_URL_RE.exec(href);
  if (docM) return resolvers.checkDocLink?.(docM[1]) ? { kind: "keep" } : { kind: "drop", reason: `链接指向的页面不可访问：${href}` };
  const attM = ATTACHMENT_URL_RE.exec(href);
  if (attM) {
    const info = resolvers.checkAttachment?.(attM[1]);
    return info ? { kind: "attachment", attachment: info } : { kind: "drop", reason: `链接指向的附件不在目标空间：${href}` };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return { kind: "drop", reason: `不支持的链接协议：${href.slice(0, 60)}` };
  return resolvers.resolveLocal?.(href) ?? { kind: "drop", reason: `无法解析的引用：${href.slice(0, 80)}` };
}

const imageFallback = (alt: string): JSONNode => ({ type: "text", text: `［图片：${alt}］` });

/**
 * 二次处理导入的 JSON：校验/重写链接与图片、把单链接段落转成附件块。
 * 在页面 id 与附件 id 都已知后调用（导入事务内）。
 */
export function finalizeImportedDoc(input: JSONNode, resolvers: ImportResolvers, warnings: string[]): JSONNode {
  const stripLink = (n: JSONNode): JSONNode => ({ ...n, marks: (n.marks ?? []).filter((mk) => mk.type !== "link") });

  const resolveImage = (n: JSONNode): JSONNode => {
    const src = String(n.attrs?.src ?? "");
    const alt = String(n.attrs?.alt ?? "");
    if (/^https?:\/\//i.test(src)) return n;
    const m = ATTACHMENT_URL_RE.exec(src);
    if (m) {
      if (resolvers.checkAttachment?.(m[1])) return n;
      warnings.push(`图片指向的附件不在目标空间：${src}`);
      return imageFallback(alt);
    }
    if (BAD_HREF_RE.test(src) || src.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
      warnings.push(`不安全的图片地址：${src.slice(0, 60)}`);
      return imageFallback(alt);
    }
    const r = resolvers.resolveLocal?.(src);
    if (r?.kind === "attachment") return { ...n, attrs: { ...n.attrs, src: `/api/docs/attachments/${r.attachment.id}` } };
    warnings.push(`无法解析的图片引用：${src.slice(0, 80)}`);
    return imageFallback(alt);
  };

  const inline = (nodes: JSONNode[], inCallout: boolean): JSONNode[] =>
    nodes.flatMap((n) => {
      if (n.type === "text" && n.marks?.some((mk) => mk.type === "link")) {
        const link = n.marks.find((mk) => mk.type === "link")!;
        const href = String(link.attrs?.href ?? "");
        const r = classifyHref(href, resolvers);
        if (r.kind === "drop") {
          warnings.push(r.reason);
          return [stripLink(n)];
        }
        const newHref =
          r.kind === "doc"
            ? `/docs/${r.docId}`
            : r.kind === "attachment"
              ? `/api/docs/attachments/${r.attachment.id}?download=1`
              : (r.href ?? href);
        return [
          {
            ...n,
            marks: n.marks.map((mk) => (mk.type === "link" ? { ...mk, attrs: { ...mk.attrs, href: newHref } } : mk)),
          },
        ];
      }
      if (n.type === "image") {
        const resolved = resolveImage(n);
        if (inCallout && resolved.type === "image") {
          const src = String(resolved.attrs?.src ?? "");
          const alt = String(resolved.attrs?.alt ?? "");
          return [{ type: "text", text: alt ? `［图片：${alt}］` : "［图片］", marks: [{ type: "link", attrs: { href: src } }] }];
        }
        return [resolved];
      }
      if (n.content) return [{ ...n, content: inline(n.content, inCallout) }];
      return [n];
    });

  // image 是块节点：行内图片先按内联处理，残留的块节点从段落里拆出来
  const hoistImages = (n: JSONNode): JSONNode[] => {
    const content = n.content ?? [];
    if (!content.some((c) => c.type === "image")) return [n];
    const out: JSONNode[] = [];
    let buf: JSONNode[] = [];
    for (const c of content) {
      if (c.type === "image") {
        if (buf.length) out.push({ ...n, content: buf });
        out.push(c);
        buf = [];
      } else buf.push(c);
    }
    if (buf.length) out.push({ ...n, content: buf });
    return out;
  };

  // allowAtt：仅顶层与引用块内的“单链接段落”可转成附件块；callout 只允许 paragraph+
  const block = (n: JSONNode, allowAtt: boolean, inCallout: boolean): JSONNode[] => {
    if (n.type === "paragraph" || n.type === "heading") {
      const content = n.content ?? [];
      if (
        n.type === "paragraph" &&
        allowAtt &&
        content.length === 1 &&
        content[0].type === "text" &&
        content[0].marks?.length === 1 &&
        content[0].marks[0].type === "link"
      ) {
        const href = String(content[0].marks[0].attrs?.href ?? "");
        const r = classifyHref(href, resolvers);
        if (r.kind === "attachment") {
          return [
            {
              type: "fileAttachment",
              attrs: {
                id: r.attachment.id,
                fileName: r.attachment.fileName || String(content[0].text ?? ""),
                mediaType: r.attachment.mediaType || "",
                size: r.attachment.size || 0,
              },
            },
          ];
        }
      }
      const next = { ...n, content: inline(content, inCallout) };
      return inCallout ? [next] : hoistImages(next);
    }
    if (n.type === "image") return [resolveImage(n)];
    if (n.content) {
      const innerAllowAtt = n.type === "blockquote";
      const childInCallout = inCallout || n.type === "callout";
      return [{ ...n, content: n.content.flatMap((c) => block(c, innerAllowAtt, childInCallout)) }];
    }
    return [n];
  };

  return { ...input, content: (input.content ?? []).flatMap((c) => block(c, true, false)) };
}

let schemaCache: ReturnType<typeof getSchema> | null = null;

/** 用 schema 校验最终 JSON；不合法抛出错误 */
export function checkDoc(json: JSONNode): void {
  schemaCache ??= getSchema(createSchemaExtensions());
  PMNode.fromJSON(schemaCache, json).check();
}
