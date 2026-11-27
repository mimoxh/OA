/**
 * Markdown 安全渲染：原始 HTML 一律按文本转义，链接只保留 http(s) / mailto / tel，
 * 图片只显示内嵌的 data:image（不向外网或站内接口发请求），其余显示为文字占位。
 */
import { Marked } from "marked";
import { escapeHtml, isSafeImageSrc, isSafeLinkHref } from "./safe-html";

const md = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!isSafeLinkHref(href) || href.trim().startsWith("#")) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href.trim())}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
    image({ href, title, text }) {
      if (isSafeImageSrc(href)) {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(href.trim())}" alt="${escapeHtml(text)}"${t}>`;
      }
      return `<span class="md-image-placeholder">[图片${text ? `：${escapeHtml(text)}` : ""}]</span>`;
    },
    checkbox({ checked }) {
      return checked ? "☑ " : "☐ ";
    },
  },
});

export function renderMarkdownSafe(src: string): string {
  return md.parse(src) as string;
}
