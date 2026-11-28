/**
 * 渲染 Word 文档、Markdown 等外部内容时的安全清理：去掉脚本、内嵌框架、事件属性和 javascript: 等危险链接。
 * 只依赖最小的 DOM 接口，方便在没有浏览器的单元测试里验证。
 */

const STRIP = /[\u0000-\u0020\u007f-\u009f]+/g;

function scheme(url: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(STRIP, ""));
  return m ? m[1].toLowerCase() : null;
}

/** 可以点击的链接：http(s)、mailto、tel 和页内锚点 */
export function isSafeLinkHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const v = href.trim();
  if (v.startsWith("#")) return true;
  const s = scheme(v);
  return s === "http" || s === "https" || s === "mailto" || s === "tel";
}

/** 外部链接（新窗口打开） */
export function isExternalHref(href: string): boolean {
  const s = scheme(href.trim());
  return s === "http" || s === "https";
}

/** 图片地址：只允许本地生成的 blob: 和 data:image/*（不发起任何网络请求，也不会请求站内接口） */
export function isSafeImageSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  const v = src.replace(STRIP, "").toLowerCase();
  return v.startsWith("blob:") || /^data:image\/[a-z0-9.+-]+[;,]/.test(v);
}

const DANGEROUS_TAGS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "link", "meta", "base",
  "form", "input", "button", "textarea", "select", "option", "noscript", "template", "slot",
  "animate", "set", "animatemotion", "animatetransform", "handler", "listener", "foreignobject",
]);

export function isDangerousTag(tagName: string): boolean {
  return DANGEROUS_TAGS.has(tagName.toLowerCase());
}

const URL_ATTRS = new Set(["href", "xlink:href", "src", "action", "formaction", "poster", "data", "background", "lowsrc", "dynsrc", "ping", "srcset", "cite", "longdesc", "usemap", "codebase"]);

/** 返回 true 表示这个属性要删除 */
export function isDangerousAttribute(tagName: string, name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("on")) return true;
  if (n === "srcdoc" || n === "formaction" || n === "action" || n === "ping" || n === "srcset" || n === "http-equiv") return true;
  if (n === "style") return /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(value) || hasRemoteCssUrl(value);
  if (!URL_ATTRS.has(n)) return false;
  const tag = tagName.toLowerCase();
  if (n === "src" || n === "poster" || n === "background" || n === "lowsrc" || n === "dynsrc") return !isSafeImageSrc(value);
  if ((n === "href" || n === "xlink:href") && (tag === "a" || tag === "area")) return !isSafeLinkHref(value);
  if (n === "href" || n === "xlink:href") return !(value.trim().startsWith("#") || isSafeImageSrc(value));
  return true;
}

function hasRemoteCssUrl(css: string): boolean {
  const re = /url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) if (!isSafeImageSrc(m[2])) return true;
  return /@import/i.test(css);
}

/** 清理样式表文本：去掉 @import 和指向外部 / 站内接口的 url()（只保留 blob: / data:image） */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (all, _q, u: string) => (isSafeImageSrc(u) ? all : "none"))
    .replace(/expression\s*\(/gi, "(")
    .replace(/behavior\s*:/gi, "x-behavior:")
    .replace(/-moz-binding/gi, "x-binding");
}

/** 最小 DOM 接口（浏览器的 Element 满足它） */
export interface SanitizableElement {
  readonly tagName: string;
  readonly children: ArrayLike<SanitizableElement> | Iterable<SanitizableElement>;
  readonly attributes: ArrayLike<{ name: string; value: string }>;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  remove(): void;
  textContent: string | null;
}

/** 就地清理一棵 DOM 子树；返回删除的元素和属性数量 */
export function sanitizeTree(root: SanitizableElement): { removedElements: number; removedAttributes: number } {
  let removedElements = 0;
  let removedAttributes = 0;
  const visit = (el: SanitizableElement) => {
    for (const child of Array.from(el.children as ArrayLike<SanitizableElement>)) {
      const tag = child.tagName.toLowerCase();
      if (isDangerousTag(tag)) {
        child.remove();
        removedElements++;
        continue;
      }
      if (tag === "style") {
        child.textContent = sanitizeCss(child.textContent ?? "");
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        if (isDangerousAttribute(tag, attr.name, attr.value)) {
          child.removeAttribute(attr.name);
          removedAttributes++;
        }
      }
      if (tag === "a" && isExternalHref(getAttr(child, "href"))) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      visit(child);
    }
  };
  visit(root);
  return { removedElements, removedAttributes };
}

function getAttr(el: SanitizableElement, name: string): string {
  for (const a of Array.from(el.attributes)) if (a.name.toLowerCase() === name) return a.value;
  return "";
}

/** HTML 转义（用于把不可信文本拼进 HTML 字符串） */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
