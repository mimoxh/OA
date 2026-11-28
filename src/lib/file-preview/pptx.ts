/**
 * 演示文稿（.pptx）解析：用 fflate 解压、浏览器 DOMParser 读 XML，生成按页的简化模型（位置、文字、图片、表格、备注）。
 * 只在浏览器里运行。支持占位符从版式 / 母版继承位置和字号、主题色、组合形状、背景色；
 * 不支持动画、SmartArt / 图表的图形渲染（显示占位框）、EMF/WMF 矢量图、艺术字效果。
 */
import { unzipSync, strFromU8 } from "fflate";

export type Box = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean };
export type Run = {
  text: string;
  br?: boolean;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  font: string | null;
};
export type Paragraph = { align: "left" | "center" | "right" | "justify"; level: number; bullet: string | null; runs: Run[]; lineHeight: number | null; empty: boolean; size: number };
export type TextBody = {
  anchor: "t" | "ctr" | "b";
  insets: [number, number, number, number];
  vertical: boolean;
  wrap: boolean;
  paragraphs: Paragraph[];
};
export type SlideElement =
  | { type: "shape"; box: Box; fill: string | null; line: { color: string; width: number } | null; radius: string | null; text: TextBody | null }
  | { type: "image"; box: Box; src: string | null; note: string | null }
  | { type: "table"; box: Box; cols: number[]; rows: { h: number; cells: TableCell[] }[] }
  | { type: "placeholder"; box: Box; label: string };
export type TableCell = { text: TextBody; fill: string | null; colSpan: number; rowSpan: number; hidden: boolean };
export type Slide = { index: number; hidden: boolean; background: string; backgroundImage: string | null; elements: SlideElement[]; notes: string };
export type Deck = { width: number; height: number; slides: Slide[]; total: number; objectUrls: string[] };

export class PptxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptxError";
  }
}

const MAX_UNZIPPED = 400 * 1024 * 1024;
const SKIP_PART = /^(ppt\/(embeddings|fonts|media\/.*\.(mp4|m4v|mov|avi|wmv|wav|mp3|m4a|wma))|docProps\/thumbnail)/i;
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };

// ---------- XML 小工具（按 localName 查找，忽略命名空间前缀） ----------
type El = Element;
const kids = (el: El | null | undefined, name: string): El[] => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el: El | null | undefined, name: string): El | null => (el ? (Array.from(el.children).find((c) => c.localName === name) ?? null) : null);
const path = (el: El | null | undefined, ...names: string[]): El | null => {
  let cur: El | null | undefined = el;
  for (const n of names) cur = kid(cur, n);
  return cur ?? null;
};
const num = (v: string | null | undefined, d = 0) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : d;
};
const attr = (el: El | null | undefined, name: string) => el?.getAttribute(name) ?? null;
/** r:embed / r:id 这类带前缀的属性 */
const rAttr = (el: El | null | undefined, local: string) => {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) if (a.localName === local && a.prefix) return a.value;
  return null;
};

function resolvePart(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
function relsPath(part: string) {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
}

// ---------- 颜色 ----------
type Theme = Record<string, string>;
const PRESET: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", darkGray: "A9A9A9", lightGray: "D3D3D3", orange: "FFA500" };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.padStart(6, "0").slice(-6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

/** 解析 a:srgbClr / a:schemeClr / a:sysClr / a:prstClr 及亮度、透明度修饰 */
function colorOf(container: El | null, theme: Theme, override?: string | null): string | null {
  if (!container) return null;
  const c = Array.from(container.children).find((x) => ["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr"].includes(x.localName));
  if (!c) return null;
  let hex: string | undefined;
  if (c.localName === "srgbClr") hex = attr(c, "val") ?? undefined;
  else if (c.localName === "sysClr") hex = attr(c, "lastClr") ?? (attr(c, "val") === "window" ? "FFFFFF" : "000000");
  else if (c.localName === "prstClr") hex = PRESET[attr(c, "val") ?? ""] ?? "000000";
  else if (c.localName === "scrgbClr") {
    const ch = (k: string) => Math.round(Math.min(1, num(attr(c, k)) / 100000) * 255).toString(16).padStart(2, "0");
    hex = ch("r") + ch("g") + ch("b");
  } else {
    const v = attr(c, "val") ?? "";
    hex = v === "phClr" && override ? override : theme[v];
  }
  if (!hex) return null;
  let [r, g, b] = hexToRgb(hex);
  let alpha = 1;
  for (const m of Array.from(c.children)) {
    const v = num(attr(m, "val")) / 100000;
    if (m.localName === "alpha") alpha = v;
    else if (m.localName === "lumMod" || m.localName === "lumOff") {
      const [h, s, l] = rgbToHsl(r, g, b);
      [r, g, b] = hslToRgb(h, s, Math.min(1, Math.max(0, m.localName === "lumMod" ? l * v : l + v)));
    } else if (m.localName === "tint") {
      r += (255 - r) * (1 - v); g += (255 - g) * (1 - v); b += (255 - b) * (1 - v);
    } else if (m.localName === "shade") {
      r *= v; g *= v; b *= v;
    }
  }
  const to = (n: number) => Math.round(Math.max(0, Math.min(255, n)));
  return alpha < 1 ? `rgba(${to(r)},${to(g)},${to(b)},${alpha.toFixed(3)})` : `rgb(${to(r)},${to(g)},${to(b)})`;
}

/** spPr / bgPr / tcPr 里的填充：纯色、渐变（取第一个色标）、无填充 */
function fillOf(pr: El | null, theme: Theme): string | null | "none" {
  if (!pr) return null;
  if (kid(pr, "noFill")) return "none";
  const solid = kid(pr, "solidFill");
  if (solid) return colorOf(solid, theme);
  const grad = kid(pr, "gradFill");
  if (grad) {
    const stops = kids(kid(grad, "gsLst"), "gs").map((g) => ({ pos: num(attr(g, "pos")) / 1000, c: colorOf(g, theme) })).filter((s) => s.c);
    if (stops.length > 1) return `linear-gradient(180deg, ${stops.map((s) => `${s.c} ${s.pos}%`).join(", ")})`;
    return stops[0]?.c ?? null;
  }
  return null;
}

// ---------- 主体 ----------
type Part = { name: string; doc: Document; rels: Map<string, { target: string; type: string }> };

export async function parsePptx(bytes: Uint8Array, opts: { maxSlides: number }): Promise<Deck> {
  let unzipped = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (SKIP_PART.test(f.name)) return false;
        unzipped += f.originalSize;
        if (unzipped > MAX_UNZIPPED) throw new PptxError("解压后体积超过 400 MB，可能是异常文件");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PptxError) throw e;
    throw new PptxError("文件已损坏，无法解压");
  }
  const xmlCache = new Map<string, Part | null>();
  const parser = new DOMParser();
  const load = (name: string): Part | null => {
    if (xmlCache.has(name)) return xmlCache.get(name)!;
    const data = files[name];
    let part: Part | null = null;
    if (data) {
      const doc = parser.parseFromString(strFromU8(data), "application/xml");
      if (!doc.getElementsByTagName("parsererror").length) {
        const rels = new Map<string, { target: string; type: string }>();
        const relData = files[relsPath(name)];
        if (relData) {
          const rd = parser.parseFromString(strFromU8(relData), "application/xml");
          for (const r of Array.from(rd.getElementsByTagName("Relationship"))) {
            const mode = r.getAttribute("TargetMode");
            const target = r.getAttribute("Target") ?? "";
            rels.set(r.getAttribute("Id") ?? "", { target: mode === "External" ? "" : resolvePart(name, target), type: r.getAttribute("Type") ?? "" });
          }
        }
        part = { name, doc, rels };
      }
    }
    xmlCache.set(name, part);
    return part;
  };
  const relOfType = (p: Part | null, suffix: string) => {
    if (!p) return null;
    for (const r of p.rels.values()) if (r.type.endsWith(suffix)) return r.target;
    return null;
  };

  const pres = load("ppt/presentation.xml");
  if (!pres) throw new PptxError("缺少 ppt/presentation.xml，不是有效的演示文稿");
  const root = pres.doc.documentElement;
  const sz = kid(root, "sldSz");
  const width = num(attr(sz, "cx"), 9144000);
  const height = num(attr(sz, "cy"), 6858000);
  const slideIds = kids(kid(root, "sldIdLst"), "sldId").map((s) => rAttr(s, "id")).filter(Boolean) as string[];
  const slideParts = slideIds.map((id) => pres.rels.get(id)?.target).filter(Boolean) as string[];

  const objectUrls: string[] = [];
  const blobCache = new Map<string, string | null>();
  const imageUrl = (partName: string): string | null => {
    if (blobCache.has(partName)) return blobCache.get(partName)!;
    const data = files[partName];
    const ext = partName.split(".").pop()?.toLowerCase() ?? "";
    let url: string | null = null;
    if (data && IMAGE_MIME[ext]) {
      url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: IMAGE_MIME[ext] }));
      objectUrls.push(url);
    }
    blobCache.set(partName, url);
    return url;
  };

  const themeOf = (master: Part | null): Theme => {
    const t = load(relOfType(master, "/theme") ?? "");
    const theme: Theme = {};
    const scheme = t?.doc.getElementsByTagNameNS("*", "clrScheme")[0];
    if (scheme) {
      for (const c of Array.from(scheme.children)) {
        const v = kid(c, "srgbClr") ? attr(kid(c, "srgbClr"), "val") : attr(kid(c, "sysClr"), "lastClr");
        if (v) theme[c.localName] = v;
      }
    }
    // 母版的 clrMap 把 bg1 / tx1 等映射到主题色
    const map = master ? kid(master.doc.documentElement, "clrMap") : null;
    const m = (k: string, d: string) => theme[attr(map, k) ?? d];
    Object.assign(theme, { bg1: m("bg1", "lt1"), tx1: m("tx1", "dk1"), bg2: m("bg2", "lt2"), tx2: m("tx2", "dk2") });
    return theme;
  };

  const total = slideParts.length;
  const slides: Slide[] = [];
  for (let i = 0; i < Math.min(total, opts.maxSlides); i++) {
    const slide = load(slideParts[i]);
    if (!slide) {
      slides.push({ index: i, hidden: false, background: "#fff", backgroundImage: null, elements: [{ type: "placeholder", box: { x: 0, y: 0, w: width, h: height, rot: 0, flipH: false, flipV: false }, label: "这一页无法解析" }], notes: "" });
      continue;
    }
    const layout = load(relOfType(slide, "/slideLayout") ?? "");
    const master = load(relOfType(layout, "/slideMaster") ?? "");
    const theme = themeOf(master);
    const ctx = new SlideContext(slide, layout, master, theme, imageUrl);
    const elements: SlideElement[] = [];
    const showMaster = (p: Part | null) => attr(p?.doc.documentElement, "showMasterSp") !== "0";
    if (showMaster(slide) && showMaster(layout) && master) elements.push(...ctx.tree(master, false));
    if (showMaster(slide) && layout) elements.push(...ctx.tree(layout, false));
    elements.push(...ctx.tree(slide, true));
    const bg = ctx.background();
    const notesPart = load(relOfType(slide, "/notesSlide") ?? "");
    let notes = "";
    if (notesPart) {
      for (const sp of Array.from(notesPart.doc.getElementsByTagNameNS("*", "sp"))) {
        const ph = path(sp, "nvSpPr", "nvPr", "ph");
        if (attr(ph, "type") === "body") {
          notes = kids(kid(sp, "txBody"), "p")
            .map((p) => Array.from(p.getElementsByTagNameNS("*", "t")).map((t) => t.textContent ?? "").join(""))
            .join("\n")
            .trim();
        }
      }
    }
    slides.push({ index: i, hidden: attr(slide.doc.documentElement, "show") === "0", background: bg.color, backgroundImage: bg.image, elements, notes });
  }
  return { width, height, slides, total, objectUrls };
}

type PhKey = { type: string; idx: string | null };
const TITLE_TYPES = new Set(["title", "ctrTitle"]);

class SlideContext {
  constructor(
    private slide: Part,
    private layout: Part | null,
    private master: Part | null,
    private theme: Theme,
    private imageUrl: (part: string) => string | null,
  ) {}

  private spTree(p: Part | null) {
    return path(p?.doc.documentElement, "cSld", "spTree");
  }

  /** 在版式 / 母版里找同一个占位符 */
  private findPh(p: Part | null, key: PhKey): El | null {
    const tree = this.spTree(p);
    if (!tree) return null;
    const all = Array.from(tree.getElementsByTagNameNS("*", "sp"));
    const phOf = (sp: El) => path(sp, "nvSpPr", "nvPr", "ph");
    if (key.idx != null) {
      const byIdx = all.find((sp) => attr(phOf(sp), "idx") === key.idx && phOf(sp));
      if (byIdx) return byIdx;
    }
    const want = key.type;
    return (
      all.find((sp) => {
        const ph = phOf(sp);
        if (!ph) return false;
        const t = attr(ph, "type") ?? "body";
        return t === want || (TITLE_TYPES.has(t) && TITLE_TYPES.has(want)) || (want === "obj" && t === "body") || (want === "subTitle" && t === "body");
      }) ?? null
    );
  }

  private chain(key: PhKey | null): { layoutSp: El | null; masterSp: El | null; txStyle: El | null } {
    if (!key) {
      return { layoutSp: null, masterSp: null, txStyle: path(this.master?.doc.documentElement, "txStyles", "otherStyle") };
    }
    const layoutSp = this.findPh(this.layout, key);
    const masterKey = layoutSp ? { type: attr(path(layoutSp, "nvSpPr", "nvPr", "ph"), "type") ?? key.type, idx: null } : { ...key, idx: null };
    const masterSp = this.findPh(this.master, masterKey);
    const styleName = TITLE_TYPES.has(masterKey.type) ? "titleStyle" : ["body", "obj", "subTitle"].includes(masterKey.type) ? "bodyStyle" : "otherStyle";
    return { layoutSp, masterSp, txStyle: path(this.master?.doc.documentElement, "txStyles", styleName) };
  }

  background(): { color: string; image: string | null } {
    for (const p of [this.slide, this.layout, this.master]) {
      const bg = path(p?.doc.documentElement, "cSld", "bg");
      if (!bg) continue;
      const pr = kid(bg, "bgPr");
      if (pr) {
        const blip = path(pr, "blipFill", "blip");
        const embed = rAttr(blip, "embed");
        const target = embed ? p!.rels.get(embed)?.target : null;
        const image = target ? this.imageUrl(target) : null;
        const f = fillOf(pr, this.theme);
        if (image || (f && f !== "none")) return { color: f && f !== "none" ? f : "#fff", image };
      }
      const ref = kid(bg, "bgRef");
      if (ref) {
        const c = colorOf(ref, this.theme);
        if (c) return { color: c, image: null };
      }
    }
    return { color: "#fff", image: null };
  }

  tree(p: Part, includePlaceholders: boolean): SlideElement[] {
    const tree = this.spTree(p);
    if (!tree) return [];
    const out: SlideElement[] = [];
    this.walk(tree, p, includePlaceholders, (b) => b, out);
    return out;
  }

  private walk(group: El, part: Part, includePh: boolean, map: (b: Box) => Box, out: SlideElement[]) {
    for (const el of Array.from(group.children)) {
      const name = el.localName;
      if (name === "sp") {
        const ph = path(el, "nvSpPr", "nvPr", "ph");
        if (ph && !includePh) continue;
        const s = this.shape(el, part, ph, map);
        if (s) out.push(s);
      } else if (name === "pic") {
        const box = this.box(path(el, "spPr", "xfrm"), map);
        if (!box) continue;
        const embed = rAttr(path(el, "blipFill", "blip"), "embed");
        const target = embed ? part.rels.get(embed)?.target : null;
        const ext = target?.split(".").pop()?.toLowerCase() ?? "";
        const src = target ? this.imageUrl(target) : null;
        out.push({ type: "image", box, src, note: src ? null : ext ? `图片（.${ext} 格式无法显示）` : "图片" });
      } else if (name === "graphicFrame") {
        const box = this.box(kid(el, "xfrm"), map);
        if (!box) continue;
        const data = path(el, "graphic", "graphicData");
        const uri = attr(data, "uri") ?? "";
        const tbl = kid(data, "tbl");
        if (tbl) out.push(this.table(tbl, box));
        else out.push({ type: "placeholder", box, label: uri.includes("chart") ? "图表（暂不支持预览）" : uri.includes("diagram") ? "SmartArt 图形（暂不支持预览）" : "嵌入对象（暂不支持预览）" });
      } else if (name === "grpSp") {
        const x = path(el, "grpSpPr", "xfrm");
        const off = kid(x, "off"), ext = kid(x, "ext"), chOff = kid(x, "chOff"), chExt = kid(x, "chExt");
        if (!off || !ext) {
          this.walk(el, part, includePh, map, out);
          continue;
        }
        const ox = num(attr(off, "x")), oy = num(attr(off, "y"));
        const sx = num(attr(ext, "cx")) / (num(attr(chExt, "cx")) || num(attr(ext, "cx")) || 1);
        const sy = num(attr(ext, "cy")) / (num(attr(chExt, "cy")) || num(attr(ext, "cy")) || 1);
        const cx = num(attr(chOff, "x"), ox), cy = num(attr(chOff, "y"), oy);
        const inner = (b: Box): Box => map({ ...b, x: ox + (b.x - cx) * sx, y: oy + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy });
        this.walk(el, part, includePh, inner, out);
      } else if (name === "AlternateContent") {
        const choice = kid(el, "Fallback") ?? kid(el, "Choice");
        if (choice) this.walk(choice, part, includePh, map, out);
      }
    }
  }

  private box(xfrm: El | null, map: (b: Box) => Box): Box | null {
    const off = kid(xfrm, "off"), ext = kid(xfrm, "ext");
    if (!off || !ext) return null;
    return map({
      x: num(attr(off, "x")),
      y: num(attr(off, "y")),
      w: num(attr(ext, "cx")),
      h: num(attr(ext, "cy")),
      rot: num(attr(xfrm, "rot")) / 60000,
      flipH: attr(xfrm, "flipH") === "1",
      flipV: attr(xfrm, "flipV") === "1",
    });
  }

  private shape(sp: El, part: Part, ph: El | null, map: (b: Box) => Box): SlideElement | null {
    const key: PhKey | null = ph ? { type: attr(ph, "type") ?? "body", idx: attr(ph, "idx") } : null;
    const inherit = this.chain(key);
    const spPr = kid(sp, "spPr");
    const xfrm = kid(spPr, "xfrm") ?? path(inherit.layoutSp, "spPr", "xfrm") ?? path(inherit.masterSp, "spPr", "xfrm");
    const box = this.box(xfrm, map);
    if (!box) return null;
    const style = kid(sp, "style");
    let fill = fillOf(spPr, this.theme);
    if (fill === null) {
      const ref = kid(style, "fillRef");
      if (ref && num(attr(ref, "idx")) > 0) fill = colorOf(ref, this.theme);
    }
    const ln = kid(spPr, "ln");
    let line: { color: string; width: number } | null = null;
    if (ln && !kid(ln, "noFill")) {
      const c = colorOf(kid(ln, "solidFill"), this.theme);
      if (c) line = { color: c, width: num(attr(ln, "w"), 12700) };
    } else if (!ln) {
      const ref = kid(style, "lnRef");
      const c = ref && num(attr(ref, "idx")) > 0 ? colorOf(ref, this.theme) : null;
      if (c) line = { color: c, width: 12700 };
    }
    const geom = attr(kid(spPr, "prstGeom"), "prst") ?? "rect";
    const radius = geom === "ellipse" ? "50%" : geom === "roundRect" ? "12%" : null;
    const fontColor = colorOf(kid(style, "fontRef"), this.theme);
    const txBody = kid(sp, "txBody");
    const text = txBody ? this.textBody(txBody, inherit, key, fontColor) : null;
    // 母版 / 版式上的空文本框不显示
    if (part !== this.slide && !text?.paragraphs.some((p) => !p.empty) && (fill === null || fill === "none") && !line) return null;
    return { type: "shape", box, fill: fill === "none" ? null : fill, line, radius, text };
  }

  private textBody(txBody: El, inherit: { layoutSp: El | null; masterSp: El | null; txStyle: El | null }, key: PhKey | null, fontColor: string | null): TextBody {
    const bodyPrs = [kid(txBody, "bodyPr"), path(inherit.layoutSp, "txBody", "bodyPr"), path(inherit.masterSp, "txBody", "bodyPr")];
    const bp = (name: string) => {
      for (const b of bodyPrs) {
        const v = attr(b, name);
        if (v != null) return v;
      }
      return null;
    };
    const autofit = kid(bodyPrs[0], "normAutofit");
    const fontScale = autofit ? num(attr(autofit, "fontScale"), 100000) / 100000 : 1;
    const lnReduce = autofit ? num(attr(autofit, "lnSpcReduction"), 0) / 100000 : 0;
    const lstStyles = [kid(txBody, "lstStyle"), path(inherit.layoutSp, "txBody", "lstStyle"), path(inherit.masterSp, "txBody", "lstStyle"), inherit.txStyle];
    const lvl = (level: number) => lstStyles.map((s) => kid(s, `lvl${level + 1}pPr`)).filter(Boolean) as El[];
    const isTitle = !!key && TITLE_TYPES.has(key.type);
    const autoNum = new Map<number, number>();
    const paragraphs: Paragraph[] = kids(txBody, "p").map((p) => {
      const pPr = kid(p, "pPr");
      const level = num(attr(pPr, "lvl"));
      const levels = [pPr, ...lvl(level)].filter(Boolean) as El[];
      const first = <T,>(f: (e: El) => T | null): T | null => {
        for (const e of levels) {
          const v = f(e);
          if (v != null) return v;
        }
        return null;
      };
      const defAttr = (name: string) => first((e) => attr(kid(e, "defRPr"), name));
      const algn = first((e) => attr(e, "algn"));
      let bullet: string | null = null;
      const bu = first((e) => (kid(e, "buNone") ? "none" : kid(e, "buChar") ? `char:${attr(kid(e, "buChar"), "char") ?? "•"}` : kid(e, "buAutoNum") ? `auto:${attr(kid(e, "buAutoNum"), "type") ?? ""}` : null));
      const hasText = kids(p, "r").some((r) => (path(r, "t")?.textContent ?? "").length > 0);
      if (bu && bu !== "none" && hasText && !isTitle) {
        if (bu.startsWith("char:")) bullet = bu.slice(5);
        else {
          const n = (autoNum.get(level) ?? 0) + 1;
          autoNum.set(level, n);
          bullet = bu.includes("alphaLc") ? `${String.fromCharCode(96 + ((n - 1) % 26) + 1)}.` : bu.includes("romanLc") ? `${["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][(n - 1) % 10]}.` : `${n}.`;
        }
      }
      const spcPct = first((e) => attr(path(e, "lnSpc", "spcPct"), "val"));
      const baseSize = num(defAttr("sz"), isTitle ? 4400 : 1800) / 100;
      const defBold = defAttr("b") === "1";
      const defColor = first((e) => colorOf(path(e, "defRPr", "solidFill"), this.theme)) ?? fontColor;
      const runs: Run[] = [];
      for (const r of Array.from(p.children)) {
        if (r.localName === "br") {
          runs.push({ text: "", br: true, size: baseSize * fontScale, bold: false, italic: false, underline: false, strike: false, color: null, font: null });
          continue;
        }
        if (r.localName !== "r" && r.localName !== "fld") continue;
        const rPr = kid(r, "rPr");
        const t = kid(r, "t")?.textContent ?? "";
        const typeface = attr(kid(rPr, "ea"), "typeface") ?? attr(kid(rPr, "latin"), "typeface");
        runs.push({
          text: t,
          size: (num(attr(rPr, "sz"), baseSize * 100) / 100) * fontScale,
          bold: attr(rPr, "b") != null ? attr(rPr, "b") === "1" : defBold,
          italic: attr(rPr, "i") === "1",
          underline: !!attr(rPr, "u") && attr(rPr, "u") !== "none",
          strike: !!attr(rPr, "strike") && attr(rPr, "strike") !== "noStrike",
          color: colorOf(kid(rPr, "solidFill"), this.theme) ?? defColor,
          font: typeface && !typeface.startsWith("+") ? typeface : null,
        });
      }
      const endSize = num(attr(kid(p, "endParaRPr"), "sz"), baseSize * 100) / 100;
      return {
        align: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" || algn === "dist" ? "justify" : "left",
        level,
        bullet,
        runs,
        lineHeight: spcPct ? Math.max(0.6, (num(spcPct) / 100000) * (1 - lnReduce)) * 1.2 : null,
        empty: !runs.some((r) => r.text),
        size: endSize * fontScale,
      };
    });
    const anchor = bp("anchor");
    const vert = bp("vert");
    return {
      anchor: anchor === "ctr" ? "ctr" : anchor === "b" ? "b" : "t",
      insets: [num(bp("lIns"), 91440), num(bp("tIns"), 45720), num(bp("rIns"), 91440), num(bp("bIns"), 45720)],
      vertical: vert === "vert" || vert === "eaVert" || vert === "wordArtVertRtl",
      wrap: bp("wrap") !== "none",
      paragraphs,
    };
  }

  private table(tbl: El, box: Box): SlideElement {
    const cols = kids(kid(tbl, "tblGrid"), "gridCol").map((c) => num(attr(c, "w")));
    const rows = kids(tbl, "tr").map((tr) => ({
      h: num(attr(tr, "h")),
      cells: kids(tr, "tc").map((tc) => {
        const tcPr = kid(tc, "tcPr");
        const f = fillOf(tcPr, this.theme);
        const txBody = kid(tc, "txBody");
        const text = txBody
          ? this.textBody(txBody, { layoutSp: null, masterSp: null, txStyle: path(this.master?.doc.documentElement, "txStyles", "otherStyle") }, null, null)
          : { anchor: "t" as const, insets: [91440, 45720, 91440, 45720] as [number, number, number, number], vertical: false, wrap: true, paragraphs: [] };
        return {
          text,
          fill: f === "none" ? null : f,
          colSpan: num(attr(tc, "gridSpan"), 1),
          rowSpan: num(attr(tc, "rowSpan"), 1),
          hidden: attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1",
        };
      }),
    }));
    return { type: "table", box, cols, rows };
  }
}

/** EMU → 像素（scale 为每 EMU 的像素数）；字号 pt → 像素 */
export const EMU_PER_PT = 12700;
