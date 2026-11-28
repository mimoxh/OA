import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, isSafeImageSrc, isSafeLinkHref, sanitizeCss, sanitizeTree, type SanitizableElement } from "@/lib/file-preview/safe-html";
import { renderMarkdownSafe } from "@/lib/file-preview/markdown";

/** 极简 DOM：足够跑 sanitizeTree */
class El implements SanitizableElement {
  children: El[] = [];
  attributes: { name: string; value: string }[];
  parent: El | null = null;
  textContent: string | null;
  constructor(public tagName: string, attrs: Record<string, string> = {}, kids: El[] = [], text: string | null = null) {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    this.textContent = text;
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
  }
  attr(name: string) {
    return this.attributes.find((a) => a.name === name)?.value;
  }
  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((a) => a.name !== name);
  }
  setAttribute(name: string, value: string) {
    this.removeAttribute(name);
    this.attributes.push({ name, value });
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  find(tag: string): El[] {
    return this.children.flatMap((c) => [...(c.tagName === tag ? [c] : []), ...c.find(tag)]);
  }
}

test("清理 Word 渲染结果：脚本、框架、事件属性、危险链接与外部资源", () => {
  const root = new El("DIV", {}, [
    new El("SCRIPT", {}, [], "alert(1)"),
    new El("IFRAME", { src: "https://evil.example" }),
    new El("P", { onclick: "alert(1)", class: "ok" }, [
      new El("A", { href: "javascript:alert(1)" }),
      new El("A", { href: " JaVa\tScRiPt:alert(1)" }),
      new El("A", { href: "https://example.com/x" }),
      new El("A", { href: "#bookmark" }),
    ]),
    new El("IMG", { src: "blob:http://localhost/abc", onerror: "alert(1)" }),
    new El("IMG", { src: "http://tracker.example/pixel.gif" }),
    new El("IMG", { src: "/api/im/files/123?download=1" }),
    new El("SVG", {}, [new El("FOREIGNOBJECT"), new El("USE", { "xlink:href": "https://evil/x.svg#a" }), new El("ANIMATE", { attributeName: "href" })]),
    new El("SPAN", { style: "background:url(https://evil/x.png)" }),
    new El("SPAN", { style: "color:red" }),
    new El("STYLE", {}, [], "@import url(https://evil/x.css); .a{background:url('https://evil/a.png')} .b{background:url(data:image/png;base64,AAAA)}"),
    new El("FORM", { action: "https://evil" }, [new El("INPUT")]),
  ]);
  sanitizeTree(root);
  assert.equal(root.find("SCRIPT").length + root.find("IFRAME").length + root.find("FORM").length + root.find("INPUT").length, 0);
  assert.equal(root.find("FOREIGNOBJECT").length + root.find("ANIMATE").length, 0);
  const p = root.find("P")[0];
  assert.equal(p.attr("onclick"), undefined);
  assert.equal(p.attr("class"), "ok");
  const links = root.find("A");
  assert.equal(links[0].attr("href"), undefined);
  assert.equal(links[1].attr("href"), undefined);
  assert.equal(links[2].attr("href"), "https://example.com/x");
  assert.equal(links[2].attr("target"), "_blank");
  assert.equal(links[2].attr("rel"), "noopener noreferrer");
  assert.equal(links[3].attr("href"), "#bookmark");
  const imgs = root.find("IMG");
  assert.equal(imgs[0].attr("src"), "blob:http://localhost/abc");
  assert.equal(imgs[0].attr("onerror"), undefined);
  assert.equal(imgs[1].attr("src"), undefined);
  assert.equal(imgs[2].attr("src"), undefined);
  assert.equal(root.find("USE")[0].attr("xlink:href"), undefined);
  const spans = root.find("SPAN");
  assert.equal(spans[0].attr("style"), undefined);
  assert.equal(spans[1].attr("style"), "color:red");
  const css = root.find("STYLE")[0].textContent!;
  assert.doesNotMatch(css, /@import|evil/);
  assert.match(css, /data:image\/png;base64,AAAA/);
});

test("链接与图片地址白名单", () => {
  for (const ok of ["https://a.cn", "http://a.cn", "mailto:a@b.cn", "tel:123", "#x"]) assert.ok(isSafeLinkHref(ok), ok);
  for (const bad of ["javascript:alert(1)", "\u0001javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd", "", null])
    assert.ok(!isSafeLinkHref(bad), String(bad));
  assert.ok(isSafeImageSrc("data:image/png;base64,AAA"));
  assert.ok(isSafeImageSrc("blob:http://x/y"));
  assert.ok(!isSafeImageSrc("data:image/svg+xml"));
  assert.ok(!isSafeImageSrc("data:text/html;base64,AAA"));
  assert.ok(!isSafeImageSrc("https://x/y.png"));
  assert.ok(!isSafeImageSrc("/api/docs/attachments/x"));
  assert.equal(sanitizeCss("a{behavior:url(x.htc);width:expression(alert(1))}"), "a{x-behavior:none;width:(alert(1))}");
  assert.equal(escapeHtml(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
});

test("Markdown：原始 HTML 转义，危险链接和外部图片不生效", () => {
  const html = renderMarkdownSafe(
    [
      "# 标题",
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "[坏链接](javascript:alert(1)) [好链接](https://example.com)",
      "![外部图片](https://tracker.example/p.png)",
      "![内嵌](data:image/png;base64,AAAA)",
      "- [x] 已完成",
      "",
      "| 姓名 | 金额 |\n| --- | --- |\n| 王芳 | 100 |",
    ].join("\n\n"),
  );
  assert.doesNotMatch(html, /<script|<img src="x"|onerror="/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">好链接<\/a>/);
  assert.doesNotMatch(html, /tracker\.example/);
  assert.match(html, /\[图片：外部图片\]/);
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="内嵌">/);
  assert.match(html, /<h1[^>]*>标题<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /☑ /);
});
