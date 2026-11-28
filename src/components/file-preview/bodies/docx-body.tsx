"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeTree, sanitizeCss } from "@/lib/file-preview/safe-html";
import { checkContainer, corrupted, ENCRYPTED_OFFICE, type PreviewFailure } from "@/lib/file-preview/sniff";
import { PreviewError, PreviewLoading, ZoomControls } from "../preview-states";
import type { PreviewBodyProps } from "../types";
import { useFileBytes } from "../use-file-bytes";

const MAX_ZOOM = 3;
const MIN_ZOOM = 0.5;

/** 渲染在 Shadow DOM 里：文档自带的样式表只作用于预览内容，不会影响页面其他部分 */
const BASE_CSS = `
:host { all: initial; display: block; }
.wrap { padding: 12px 0 24px; }
.docx-wrapper { background: transparent !important; padding: 0 !important; display: flex; flex-direction: column; align-items: center; }
.docx-wrapper > section.docx { box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.08); margin-bottom: 16px !important; }
.docx { color: #000; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif; }
.docx img { max-width: none; }
.docx a { color: #1a5fb4; }
.docx table { border-collapse: collapse; }
`;

/**
 * Word（.docx）：docx-preview 按页排版渲染（标题、段落、列表、表格、图片、页眉页脚、脚注），
 * 渲染结果再做一次安全清理（链接、事件属性、内嵌 HTML 片段）；手机上按屏幕宽度缩放，可放大后横向滚动。
 */
export default function DocxBody({ src, fileName, size, info, downloadHref, fullscreen, dark }: PreviewBodyProps) {
  const bytes = useFileBytes(src, { size });
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  const [rendered, setRendered] = useState(false);
  const [pageWidth, setPageWidth] = useState(0);
  const [viewWidth, setViewWidth] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (bytes.kind !== "ready" || !host.current) return;
    const data = bytes.bytes;
    const bad = checkContainer(info, data);
    if (bad) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailure(bad);
      return;
    }
    let cancelled = false;
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
    root.innerHTML = "";
    const base = document.createElement("style");
    base.textContent = BASE_CSS;
    const styles = document.createElement("div");
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const body = document.createElement("div");
    wrap.appendChild(body);
    root.append(base, styles, wrap);
    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(data, body, styles, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          // 内嵌字体放在 Shadow DOM 里不生效，中文用系统字体
          ignoreFonts: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          // altChunk 是嵌在 Word 里的 HTML 片段，会用 iframe 渲染，不显示
          renderAltChunks: false,
          renderComments: false,
          renderChanges: false,
          useBase64URL: false,
          experimental: false,
        }),
      )
      .then(() => {
        if (cancelled) return;
        for (const s of Array.from(styles.querySelectorAll("style"))) s.textContent = sanitizeCss(s.textContent ?? "");
        sanitizeTree(body);
        const pages = Array.from(body.querySelectorAll<HTMLElement>("section.docx"));
        setPageWidth(Math.max(0, ...pages.map((p) => p.offsetWidth)) || body.scrollWidth);
        setRendered(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = String((e as Error)?.message ?? e);
        setFailure(/encrypt|password/i.test(msg) ? ENCRYPTED_OFFICE : corrupted(info.label));
      });
    const onClick = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.("a");
      const href = a?.getAttribute("href") ?? "";
      if (!a) return;
      if (href.startsWith("#")) {
        e.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        (root.getElementById(id) ?? root.querySelector(`[name="${CSS.escape(id)}"]`))?.scrollIntoView({ block: "start" });
      } else if (!a.getAttribute("target")) {
        e.preventDefault();
      }
    };
    root.addEventListener("click", onClick);
    return () => {
      cancelled = true;
      root.removeEventListener("click", onClick);
      // docx-preview 为图片创建的 blob: 地址随内容一起释放
      for (const img of Array.from(root.querySelectorAll("img"))) if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
      root.innerHTML = "";
    };
  }, [bytes, info]);

  const setScroll = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    if (!el) return;
    setViewWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = pageWidth && viewWidth ? Math.min(1, (viewWidth - (fullscreen ? 16 : 48)) / pageWidth) : 1;
  const scale = fit * zoom;

  if (bytes.kind === "error") return <PreviewError dark={dark} failure={bytes.failure} downloadHref={downloadHref} fileName={fileName} />;
  if (failure) return <PreviewError dark={dark} failure={failure} downloadHref={downloadHref} fileName={fileName} />;
  return (
    <>
      {(bytes.kind === "loading" || !rendered) && (
        <PreviewLoading dark={dark} loaded={bytes.kind === "loading" ? bytes.loaded : 0} total={bytes.kind === "loading" ? bytes.total : 0} label={bytes.kind === "ready" ? "正在排版…" : undefined} />
      )}
      <div ref={setScroll} className={rendered ? "absolute inset-0 overflow-auto overscroll-contain" : "invisible absolute inset-0 overflow-hidden"} data-docx-scroller>
        {/* zoom 会参与布局（与 transform 不同），缩放后滚动范围随之变化，横向不会溢出到页面 */}
        <div ref={host} style={{ zoom: scale }} data-docx-host />
      </div>
      {rendered && (
        <ZoomControls dark={dark} zoom={zoom} min={MIN_ZOOM} max={MAX_ZOOM} onZoom={setZoom} className="absolute bottom-3 right-3" />
      )}
    </>
  );
}
