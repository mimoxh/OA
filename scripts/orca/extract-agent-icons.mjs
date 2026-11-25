/**
 * 从本机 Orca 客户端安装包只读提取各基座（Agent）的原版图标，离线内置到 OA：
 *   public/agent-icons/<id>.png                       Orca 内嵌的位图图标（data URI 解码后的 PNG）
 *   src/components/im/orca-agent-icons.generated.ts   矢量图标（序列化后的 SVG）、位图路径、基座名称与别名
 *
 * 用法：node scripts/orca/extract-agent-icons.mjs [Orca resources 目录]
 *   默认目录：ORCA_RESOURCES_DIR > Windows %LOCALAPPDATA%\Programs\orca\resources
 *             > macOS /Applications/Orca.app/Contents/Resources > Linux /opt/Orca/resources
 *
 * Orca 渲染端的 AgentIcon 由三部分组成（文件名带构建哈希，按特征定位）：
 *   1. out/renderer/assets/agent-catalog-*.js：claude / codex / droid / opencode 等内联 SVG 组件、内置基座目录；
 *   2. 引用该模块且包含 `antigravity:\`data:image` 的渲染模块：AgentIcon 的 id → 组件分派与内嵌 PNG 映射；
 *   3. 仍未覆盖的基座 Orca 会在线加载 favicon，这里不提取（OA 端用兜底图标，保证离线）。
 * 只读取安装目录（app.asar 或 app.asar.unpacked），不修改 Orca 的任何文件。
 * 生成过程会以桩对象执行 agent-catalog 模块以得到 SVG 元素树；该模块只定义组件与常量，无副作用。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_TS = path.join(ROOT, "src/components/im/orca-agent-icons.generated.ts");
const OUT_PNG_DIR = path.join(ROOT, "public/agent-icons");

function defaultResourcesDir() {
  if (process.env.ORCA_RESOURCES_DIR) return process.env.ORCA_RESOURCES_DIR;
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "Programs/orca/resources");
  if (process.platform === "darwin") return "/Applications/Orca.app/Contents/Resources";
  return "/opt/Orca/resources";
}

/** 极简 asar 读取：头部为 pickle 包裹的 JSON 目录，文件内容紧随其后；unpacked 文件位于 app.asar.unpacked */
function openAsar(resources) {
  const asarPath = path.join(resources, "app.asar");
  const unpackedDir = path.join(resources, "app.asar.unpacked");
  const fd = fs.openSync(asarPath, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);
  const jsonLen = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLen);
  fs.readSync(fd, json, 0, jsonLen, 16);
  const header = JSON.parse(json.toString("utf8"));
  const base = 8 + headerSize;
  const node = (p) => p.split("/").reduce((n, k) => n?.files?.[k], header);
  return {
    list(dir) {
      return Object.keys(node(dir)?.files ?? {});
    },
    read(p) {
      const n = node(p);
      if (!n || n.files) throw new Error(`asar 中不存在文件：${p}`);
      if (n.unpacked) return fs.readFileSync(path.join(unpackedDir, ...p.split("/")));
      const buf = Buffer.alloc(n.size);
      fs.readSync(fd, buf, 0, n.size, base + Number(n.offset));
      return buf;
    },
    close: () => fs.closeSync(fd),
  };
}

// ---------- 以桩对象执行 agent-catalog 模块 ----------

const SENTINEL = Symbol.for("react.memo_cache_sentinel");
const el = (type, props) => ({ type, props: props ?? {} });
const RUNTIME = {
  jsx: el,
  jsxs: el,
  Fragment: "#fragment",
  c: (n) => Array(n).fill(SENTINEL),
  useId: () => ":orca:",
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useMemo: (fn) => fn(),
  language: "en",
};
/**
 * 所有外部 import 都替换为同一个“万能桩”：无参调用返回 React / jsx 运行时；
 * 全部为字符串参数时视为 cn() 拼接类名；其余返回首个参数（rolldown 的 ESM 互操作包装）。
 */
function universal(...args) {
  if (args.length === 0) return RUNTIME;
  if (args.every((a) => a == null || typeof a !== "object")) {
    // i18n 的 t(key, fallback) 形态取 fallback
    if (args.length === 2 && typeof args[0] === "string" && args[0].startsWith("auto.")) return args[1];
    return args.filter((a) => typeof a === "string" && a).join(" ");
  }
  return args[0];
}
Object.assign(universal, RUNTIME);

async function loadCatalogModule(source, tmpDir) {
  const transformed = source.replace(/import\{([^}]*)\}from"[^"]+";?/g, (_, names) => {
    const locals = names.split(",").map((s) => s.trim().split(/\s+as\s+/).pop());
    return `const ${locals.map((l) => `${l}=globalThis.__orcaStub`).join(",")};`;
  });
  if (/\bimport\s*[{*\w]/.test(transformed.replace(/import\.meta/g, ""))) throw new Error("agent-catalog 模块仍包含未处理的 import");
  globalThis.__orcaStub = universal;
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, "agent-catalog.mjs");
  fs.writeFileSync(file, transformed);
  return import(pathToFileURL(file).href);
}

// ---------- 元素树 → SVG ----------

const KEEP_CAMEL = new Set(["viewBox", "gradientUnits", "gradientTransform", "maskUnits", "maskContentUnits", "clipPathUnits", "patternUnits", "preserveAspectRatio"]);
const kebab = (s) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function serialize(node) {
  if (node == null || node === false || node === true) return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node !== "object") return esc(node);
  const { children, style, ...props } = node.props;
  if (node.type === "#fragment") return serialize(children);
  if (typeof node.type !== "string") throw new Error(`无法序列化的组件节点：${String(node.type)}`);
  const attrs = Object.entries(props)
    .filter(([k, v]) => v != null && v !== false && !k.startsWith("aria-") && k !== "key" && k !== "className")
    .map(([k, v]) => `${KEEP_CAMEL.has(k) ? k : kebab(k)}="${esc(v)}"`);
  if (style && typeof style === "object") {
    const css = Object.entries(style)
      .map(([k, v]) => `${kebab(k)}:${v}`)
      .join(";");
    if (css) attrs.push(`style="${esc(css)}"`);
  }
  const inner = serialize(children);
  return `<${node.type}${attrs.length ? " " + attrs.join(" ") : ""}${inner ? `>${inner}</${node.type}>` : "/>"}`;
}

/** 渲染组件得到 { viewBox, body }；内部 id 统一改写为 __UID__-n，运行时按实例替换以免同屏冲突 */
function renderSvg(Component) {
  const root = Component({ size: 24, letter: "?" });
  if (!root || root.type !== "svg") throw new Error("图标组件的根节点不是 <svg>");
  // 根节点上的可继承绘制属性（如 codex 的 fill=currentColor）包进 <g>，其余（尺寸、类名、xmlns）由 OA 渲染时提供
  const { children, viewBox, width, height, className, xmlns, style: _style, ...paint } = root.props;
  void [width, height, className, xmlns, _style];
  let body = serialize(Object.keys(paint).some((k) => !k.startsWith("aria-")) ? el("g", { ...paint, children }) : children);
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ids.forEach((id, i) => {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    body = body.replace(new RegExp(`id="${safe}"`, "g"), `id="__UID__-${i}"`).replace(new RegExp(`url\\(#${safe}\\)`, "g"), `url(#__UID__-${i})`);
  });
  const icon = { viewBox, body, currentColor: /currentColor/.test(body), rounded: !!_style?.borderRadius };
  return { viewBox, body, tone: svgTone(icon), rounded: icon.rounded };
}

// ---------- PNG 亮度分析：判断“透明底上的深色单色图标”，深色主题下需反色 ----------

function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, depth = 0, type = 0, palette = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") [w, h, depth, type] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9]];
    else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    p += 12 + len;
  }
  if (depth !== 8 || data8Unsupported(type)) return null;
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = cur;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = (i) => {
    const o = i * ch;
    if (type === 6) return [px[o], px[o + 1], px[o + 2], px[o + 3]];
    if (type === 2) return [px[o], px[o + 1], px[o + 2], 255];
    if (type === 4) return [px[o], px[o], px[o], px[o + 1]];
    if (type === 0) return [px[o], px[o], px[o], 255];
    const k = px[o];
    return [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255];
  };
  return { w, h, rgba };
}
function data8Unsupported(type) {
  return ![0, 2, 3, 4, 6].includes(type);
}

/**
 * 按不透明像素的亮度分布给出主题适配方式：
 *   dark-glyph  透明底 + 几乎全是低饱和深色（深色主题下反色）
 *   dark-tile   整体很暗的方块 / 圆角底（深色主题下加浅色描边）
 *   light       透明底 + 几乎全是浅色（浅色主题下加深色描边）
 *   color       其余彩色图标，两种主题下都直接显示
 */
function analyzeTone(buf) {
  const img = decodePng(buf);
  if (!img) return "color";
  // 与背景接触的是图形外缘：统计外圈（边长 15% 以内）不透明像素的亮度
  const band = Math.max(1, Math.round(img.w * 0.15));
  let opaque = 0, darkMono = 0, edge = 0, edgeLum = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const [r, g, b, a] = img.rgba(y * img.w + x);
      if (a < 40) continue;
      opaque++;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (lum < 0.3 && Math.max(r, g, b) - Math.min(r, g, b) < 40) darkMono++;
      if (x < band || y < band || x >= img.w - band || y >= img.h - band) {
        edge++;
        edgeLum += lum;
      }
    }
  }
  if (!opaque) return "color";
  const coverage = opaque / (img.w * img.h);
  const outer = edge ? edgeLum / edge : 0.5;
  if (coverage < 0.6 && darkMono / opaque > 0.8) return "dark-glyph";
  if (coverage >= 0.6 && outer < 0.25) return "dark-tile";
  if (outer > 0.85) return "light";
  return "color";
}

/** 矢量图标：使用 currentColor 的随文字颜色（auto）；以黑色底块开头的视为 dark-tile */
function svgTone(icon) {
  if (icon.currentColor) return "auto";
  if (/^(?:<g[^>]*>)?<(?:rect|path)[^>]*fill="(?:#000|#000000|black)"/.test(icon.body)) return "dark-tile";
  return "color";
}

// ---------- 主流程 ----------

async function main() {
  const resources = path.resolve(process.argv[2] ?? defaultResourcesDir());
  if (!fs.existsSync(path.join(resources, "app.asar"))) throw new Error(`未找到 Orca 安装：${resources}（可通过参数或 ORCA_RESOURCES_DIR 指定 resources 目录）`);
  const asar = openAsar(resources);
  const ASSETS = "out/renderer/assets";
  const files = asar.list(ASSETS);
  const catalogFile = files.find((f) => /^agent-catalog-[\w-]+\.js$/.test(f));
  if (!catalogFile) throw new Error("未找到 agent-catalog-*.js");
  const catalogSrc = asar.read(`${ASSETS}/${catalogFile}`).toString("utf8");

  // AgentIcon 所在模块：从 agent-catalog import，且含内嵌 PNG 映射
  let iconFile = null, iconSrc = "";
  for (const f of files) {
    if (!f.endsWith(".js") || f === catalogFile) continue;
    const s = asar.read(`${ASSETS}/${f}`).toString("utf8");
    if (s.includes(`/${catalogFile}"`) && /antigravity:`data:image\/png;base64,/.test(s)) {
      iconFile = f;
      iconSrc = s;
      break;
    }
  }
  if (!iconFile) throw new Error("未找到 AgentIcon 渲染模块");

  // 1) AgentIcon 模块中的 import 别名 → agent-catalog 的导出名
  const importLine = new RegExp(`import\\{([^}]*)\\}from"\\./${catalogFile.replace(/[.]/g, "\\.")}"`).exec(iconSrc)?.[1] ?? "";
  const aliasToExport = Object.fromEntries([...importLine.matchAll(/(\w+) as ([\w$]+)/g)].map((m) => [m[2], m[1]]));

  // 2) AgentIcon 的分派：if(n===`a`||n===`b`){… jsx)(Comp,{size…
  const svgDispatch = {};
  for (const m of iconSrc.matchAll(/if\(((?:[\w$]+===`[\w.-]+`(?:\|\|)?)+)\)\{let [\w$]+;return [^]{0,160}?\.jsx\)\(([\w$]+),\{size:/g)) {
    const exp = aliasToExport[m[2]];
    if (!exp) continue;
    for (const id of m[1].matchAll(/===`([\w.-]+)`/g)) svgDispatch[id[1]] = exp;
  }
  // 字母兜底组件（无 agent 时显示 ?）
  const letterExport = aliasToExport[/\.jsx\)\(([\w$]+),\{letter:`\?`/.exec(iconSrc)?.[1] ?? ""];

  // 3) 内嵌 PNG 映射与别名（如 dsb → dsh）
  const pngStart = iconSrc.search(/[\w$]+=\{grok:`data:image|[\w$]+=\{[\w"-]+:`data:image\/png/);
  const pngMap = {};
  if (pngStart >= 0) {
    const objStart = iconSrc.indexOf("{", pngStart);
    const objEnd = iconSrc.indexOf("`}", objStart);
    const seg = iconSrc.slice(objStart + 1, objEnd + 1);
    for (const m of seg.matchAll(/(?:^|,)(?:"([\w.-]+)"|([\w$]+)):`data:image\/png;base64,([A-Za-z0-9+/=]+)`/g)) pngMap[m[1] ?? m[2]] = m[3];
  }
  const aliases = {};
  for (const m of iconSrc.matchAll(/\[[\w$]+===`([\w.-]+)`\?`([\w.-]+)`:[\w$]+\]/g)) aliases[m[1]] = m[2];

  // 4) 执行 agent-catalog：渲染 SVG、读取内置基座目录（id / label / iconUrl）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orca-icons-"));
  const mod = await loadCatalogModule(catalogSrc, tmp);
  // 内置基座目录：无参调用返回 [{ id, label, cmd }] 的导出（图标组件无参调用会抛错，忽略即可）
  let builtins = [];
  for (const fn of Object.values(mod)) {
    if (typeof fn !== "function") continue;
    try {
      const list = fn();
      if (Array.isArray(list) && list.length > 5 && list.every((a) => a && typeof a.id === "string" && "cmd" in a)) {
        builtins = list;
        break;
      }
    } catch {
      // 非目录导出
    }
  }

  // 多个基座共用一个组件时（claude-agent-teams / opencode2），只保留首个 id 的图标，其余记为别名
  const svgs = {};
  const keyOfExport = {};
  for (const [id, exp] of Object.entries(svgDispatch)) {
    const Comp = mod[exp];
    if (typeof Comp !== "function") continue;
    const key = (keyOfExport[exp] ??= id);
    if (!svgs[key]) svgs[key] = renderSvg(Comp);
    if (key !== id) aliases[id] = key;
  }
  const letter = letterExport && typeof mod[letterExport] === "function" ? renderSvg(mod[letterExport]) : null;

  // 5) 位图：内嵌 PNG + 目录中的 iconUrl（随包资源）
  fs.rmSync(OUT_PNG_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_PNG_DIR, { recursive: true });
  const pngs = {};
  const savePng = (id, buf) => {
    fs.writeFileSync(path.join(OUT_PNG_DIR, `${id}.png`), buf);
    pngs[id] = { src: `/agent-icons/${id}.png`, tone: analyzeTone(buf) };
  };
  for (const [id, b64] of Object.entries(pngMap)) if (!svgs[id]) savePng(id, Buffer.from(b64, "base64"));
  for (const a of builtins) {
    if (svgs[a.id] || pngs[a.id] || typeof a.iconUrl !== "string") continue;
    const name = /([\w.-]+\.png)$/.exec(a.iconUrl)?.[1];
    if (name && files.includes(name)) savePng(a.id, asar.read(`${ASSETS}/${name}`));
  }
  asar.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  const labels = Object.fromEntries(builtins.filter((a) => typeof a.label === "string").map((a) => [a.id, a.label]));
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

  const ts = `// 由 scripts/orca/extract-agent-icons.mjs 从 Orca 客户端安装包自动生成，请勿手改。
// 来源：${catalogFile}、${iconFile}

/**
 * 主题适配方式：auto 使用 currentColor 随文字颜色；color 彩色直接显示；
 * dark-glyph 透明底深色图形（深色主题反色）；dark-tile 深色底块（深色主题加浅色描边）；light 浅色图形（浅色主题加描边）
 */
export type OrcaIconTone = "auto" | "color" | "dark-glyph" | "dark-tile" | "light";
export type OrcaSvgIcon = { viewBox: string; body: string; tone: OrcaIconTone; rounded: boolean };
export type OrcaPngIcon = { src: string; tone: OrcaIconTone };

/** 矢量图标；body 中的 __UID__ 需在渲染时替换为实例唯一前缀 */
export const ORCA_SVG_ICONS: Record<string, OrcaSvgIcon> = ${JSON.stringify(sortObj(svgs), null, 2)};

/** 位图图标（public/agent-icons，离线可用） */
export const ORCA_PNG_ICONS: Record<string, OrcaPngIcon> = ${JSON.stringify(sortObj(pngs), null, 2)};

/** 共用图标的基座别名，如 claude-agent-teams → claude */
export const ORCA_ICON_ALIASES: Record<string, string> = ${JSON.stringify(sortObj(aliases), null, 2)};

/** Orca 未识别基座时的字母图标（? 由渲染时替换） */
export const ORCA_LETTER_ICON: OrcaSvgIcon | null = ${JSON.stringify(letter, null, 2)};

/** Orca 内置基座名称 */
export const ORCA_AGENT_LABELS: Record<string, string> = ${JSON.stringify(sortObj(labels), null, 2)};
`;
  fs.writeFileSync(OUT_TS, ts);
  console.log(
    `[orca-icons] SVG ${Object.keys(svgs).length}（${Object.keys(svgs).join(", ")}）· PNG ${Object.keys(pngs).length} · 别名 ${Object.keys(aliases).length} · 基座名称 ${Object.keys(labels).length}`,
  );
  const tones = {};
  for (const [k, v] of [...Object.entries(svgs), ...Object.entries(pngs)]) if (v.tone !== "color") (tones[v.tone] ??= []).push(k);
  console.log(`[orca-icons] 主题适配：${Object.entries(tones).map(([t, ids]) => `${t}=${ids.join("/")}`).join("；")}`);
}

main().catch((e) => {
  console.error(`[orca-icons] ${e.message}`);
  process.exit(1);
});
