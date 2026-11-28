"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { PPTX_MAX_SLIDES } from "@/lib/file-preview/kinds";
import type { Box, Deck, Slide, SlideElement, TextBody } from "@/lib/file-preview/pptx";
import { checkContainer, corrupted, type PreviewFailure } from "@/lib/file-preview/sniff";
import { cn } from "@/lib/utils";
import { PreviewError, PreviewLoading, PreviewNotice } from "../preview-states";
import type { PreviewBodyProps } from "../types";
import { useFileBytes } from "../use-file-bytes";

const EMU_PER_PT = 12700;
const FONT = `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif`;
const DESKTOP_MAX_WIDTH = 960;

function boxStyle(b: Box, s: number): CSSProperties {
  const t: string[] = [];
  if (b.rot) t.push(`rotate(${b.rot}deg)`);
  if (b.flipH) t.push("scaleX(-1)");
  if (b.flipV) t.push("scaleY(-1)");
  return { position: "absolute", left: b.x * s, top: b.y * s, width: Math.max(1, b.w * s), height: Math.max(1, b.h * s), transform: t.length ? t.join(" ") : undefined };
}

function Text({ body, s, flip }: { body: TextBody; s: number; flip?: boolean }) {
  const [l, t, r, b] = body.insets;
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{
        padding: `${t * s}px ${r * s}px ${b * s}px ${l * s}px`,
        justifyContent: body.anchor === "ctr" ? "center" : body.anchor === "b" ? "flex-end" : "flex-start",
        writingMode: body.vertical ? "vertical-rl" : undefined,
        whiteSpace: body.wrap ? "pre-wrap" : "pre",
        overflowWrap: "anywhere",
        transform: flip ? "scaleX(-1)" : undefined,
        fontFamily: FONT,
      }}
    >
      {body.paragraphs.map((p, i) => (
        <div
          key={i}
          style={{
            textAlign: p.align,
            lineHeight: p.lineHeight ?? 1.2,
            paddingLeft: p.level ? p.level * 24 * (s * EMU_PER_PT) : undefined,
            fontSize: p.size * EMU_PER_PT * s,
          }}
        >
          {p.bullet && <span style={{ marginRight: "0.4em" }}>{p.bullet}</span>}
          {p.empty
            ? " "
            : p.runs.map((run, j) =>
                run.br ? (
                  <br key={j} />
                ) : (
                  <span
                    key={j}
                    style={{
                      fontSize: run.size * EMU_PER_PT * s,
                      fontWeight: run.bold ? 700 : undefined,
                      fontStyle: run.italic ? "italic" : undefined,
                      textDecoration: [run.underline && "underline", run.strike && "line-through"].filter(Boolean).join(" ") || undefined,
                      color: run.color ?? "#000",
                      fontFamily: run.font ? `"${run.font.replace(/["\\;]/g, "")}", ${FONT}` : undefined,
                    }}
                  >
                    {run.text}
                  </span>
                ),
              )}
        </div>
      ))}
    </div>
  );
}

function Element({ el, s }: { el: SlideElement; s: number }) {
  const style = boxStyle(el.box, s);
  if (el.type === "shape") {
    return (
      <div
        style={{
          ...style,
          background: el.fill ?? undefined,
          border: el.line ? `${Math.max(0.5, el.line.width * s)}px solid ${el.line.color}` : undefined,
          borderRadius: el.radius ?? undefined,
          boxSizing: "border-box",
        }}
      >
        {el.text && <Text body={el.text} s={s} flip={el.box.flipH} />}
      </div>
    );
  }
  if (el.type === "image") {
    return el.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={el.src} alt="" draggable={false} style={{ ...style, objectFit: "fill" }} />
    ) : (
      <div style={style} className="flex items-center justify-center border border-dashed border-black/20 bg-black/[0.03] text-center text-black/40" >
        <span style={{ fontSize: Math.max(9, 12 * s * EMU_PER_PT) }}>{el.note}</span>
      </div>
    );
  }
  if (el.type === "table") {
    const totalW = el.cols.reduce((a, b) => a + b, 0) || el.box.w;
    return (
      <table style={{ ...style, height: undefined, tableLayout: "fixed", borderCollapse: "collapse", width: totalW * s }}>
        <colgroup>
          {el.cols.map((w, i) => (
            <col key={i} style={{ width: w * s }} />
          ))}
        </colgroup>
        <tbody>
          {el.rows.map((row, i) => (
            <tr key={i} style={{ height: row.h * s }}>
              {row.cells.map((c, j) =>
                c.hidden ? null : (
                  <td
                    key={j}
                    colSpan={c.colSpan > 1 ? c.colSpan : undefined}
                    rowSpan={c.rowSpan > 1 ? c.rowSpan : undefined}
                    style={{ position: "relative", border: "1px solid rgba(0,0,0,.35)", background: c.fill ?? (i === 0 ? "rgba(0,0,0,.06)" : undefined), padding: 0, verticalAlign: "top" }}
                  >
                    <div style={{ position: "relative", minHeight: row.h * s }}>
                      <Text body={{ ...c.text, anchor: c.text.anchor }} s={s} />
                      {/* 撑开行高：绝对定位的文字不参与布局，这里放一份不可见的副本 */}
                      <div style={{ visibility: "hidden", padding: `${c.text.insets[1] * s}px ${c.text.insets[2] * s}px ${c.text.insets[3] * s}px ${c.text.insets[0] * s}px` }}>
                        {c.text.paragraphs.map((p, k) => (
                          <div key={k} style={{ fontSize: Math.max(...p.runs.map((r) => r.size), p.size) * EMU_PER_PT * s, lineHeight: 1.2 }}>
                            {p.runs.map((r) => r.text).join("") || " "}
                          </div>
                        ))}
                      </div>
                    </div>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div style={style} className="flex items-center justify-center border border-dashed border-black/25 bg-black/[0.04] p-1 text-center text-black/50">
      <span style={{ fontSize: Math.max(10, 14 * s * EMU_PER_PT) }}>{el.label}</span>
    </div>
  );
}

function SlideView({ slide, deck, width, total }: { slide: Slide; deck: Deck; width: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(slide.index < 2);
  const [notesOpen, setNotesOpen] = useState(false);
  const s = width / deck.width;
  const height = Math.round(deck.height * s);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 只渲染视口附近的页（上下各留一屏），远处的页只保留占位尺寸
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="mx-auto mb-4" style={{ width }} data-pptx-slide={slide.index + 1}>
      <div className="mb-1 flex items-center justify-between px-0.5 text-xs text-ink-2">
        <span className="tabular-nums">
          第 {slide.index + 1} / {total} 页{slide.hidden && "（隐藏页）"}
        </span>
        {slide.notes && (
          <button type="button" className="rounded px-1.5 py-0.5 text-accent hover:bg-accent-soft" onClick={() => setNotesOpen((v) => !v)}>
            {notesOpen ? "收起备注" : "备注"}
          </button>
        )}
      </div>
      <div
        ref={ref}
        className="relative overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,.12),0_4px_14px_rgba(0,0,0,.08)]"
        style={{
          width,
          height,
          background: slide.background,
          backgroundImage: slide.backgroundImage ? `url("${slide.backgroundImage}")` : undefined,
          backgroundSize: "100% 100%",
          color: "#000",
        }}
      >
        {visible && slide.elements.map((el, i) => <Element key={i} el={el} s={s} />)}
      </div>
      {slide.notes && notesOpen && (
        <div className="mt-1.5 whitespace-pre-wrap rounded-md border border-line bg-white px-3 py-2 text-[13px] leading-relaxed text-ink-2" data-pptx-notes>
          {slide.notes}
        </div>
      )}
    </div>
  );
}

/**
 * 演示文稿（.pptx）：自研的轻量解析（lib/file-preview/pptx），按页竖向排列，显示页码和备注。
 * 动画、SmartArt / 图表图形、艺术字效果、EMF / WMF 图片不还原。
 */
export default function PptxBody({ src, fileName, size, info, downloadHref, fullscreen, dark }: PreviewBodyProps) {
  const bytes = useFileBytes(src, { size });
  const [deck, setDeck] = useState<Deck | null>(null);
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (bytes.kind !== "ready") return;
    const bad = checkContainer(info, bytes.bytes);
    if (bad) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailure(bad);
      return;
    }
    let cancelled = false;
    let made: Deck | null = null;
    const t = setTimeout(() => {
      import("@/lib/file-preview/pptx")
        .then(({ parsePptx }) => parsePptx(bytes.bytes, { maxSlides: PPTX_MAX_SLIDES }))
        .then(
          (d) => {
            made = d;
            if (cancelled) d.objectUrls.forEach((u) => URL.revokeObjectURL(u));
            else setDeck(d);
          },
          (e: unknown) => {
            if (cancelled) return;
            const msg = (e as Error)?.name === "PptxError" ? (e as Error).message : "";
            setFailure(msg ? { title: "无法解析该文件", detail: `${msg}。可以下载后用 PowerPoint / WPS 打开。` } : corrupted(info.label));
          },
        );
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
      made?.objectUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [bytes, info]);

  const measure = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const update = () => setWidth(Math.min(el.clientWidth - (fullscreen ? 16 : 48), fullscreen ? Infinity : DESKTOP_MAX_WIDTH));
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    },
    [fullscreen],
  );

  if (bytes.kind === "error") return <PreviewError dark={dark} failure={bytes.failure} downloadHref={downloadHref} fileName={fileName} />;
  if (failure) return <PreviewError dark={dark} failure={failure} downloadHref={downloadHref} fileName={fileName} />;
  if (bytes.kind === "loading" || !deck) {
    return <PreviewLoading dark={dark} loaded={bytes.kind === "loading" ? bytes.loaded : 0} total={bytes.kind === "loading" ? bytes.total : 0} label={bytes.kind === "ready" ? "正在解析演示文稿…" : undefined} />;
  }
  if (!deck.total) return <PreviewError dark={dark} failure={{ title: "没有幻灯片", detail: "这个演示文稿里没有任何页面。" }} downloadHref={downloadHref} fileName={fileName} />;
  return (
    <div className="absolute inset-0 flex flex-col">
      {deck.total > deck.slides.length && (
        <PreviewNotice>
          共 {deck.total} 页，仅显示前 {deck.slides.length} 页，完整内容请下载查看。
        </PreviewNotice>
      )}
      <div ref={measure} className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain", fullscreen ? "px-2 pt-3" : "px-6 pt-5")} data-pptx-scroller>
        {width > 0 && deck.slides.map((sl) => <SlideView key={sl.index} slide={sl} deck={deck} width={width} total={deck.total} />)}
        <div className="pb-4 text-center text-[11px] text-ink-3">页内预览不包含动画，复杂排版与字体可能与 PowerPoint 略有差异</div>
      </div>
    </div>
  );
}
