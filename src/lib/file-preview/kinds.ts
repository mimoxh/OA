/**
 * 文件预览：按扩展名 / MIME 判断预览方式和大小上限（IM 文件消息、文档附件共用，纯函数，可在服务端与测试中使用）。
 */

export type PreviewKind =
  | "pdf"
  | "docx"
  | "sheet"
  | "pptx"
  | "markdown"
  | "json"
  | "text"
  | "image"
  | "svg"
  | "video"
  | "audio"
  | "zip"
  | "unsupported";

export type PreviewInfo = {
  kind: PreviewKind;
  /** 小写扩展名，不含点；没有扩展名时为 "" */
  ext: string;
  /** 给用户看的类型名，例如「Word 文档」 */
  label: string;
  /** kind 为 unsupported 时的原因；为 null 表示未知类型（不在已知列表里） */
  reason: { title: string; detail: string } | null;
};

const MB = 1024 * 1024;

/**
 * 各类型的前端安全预览上限（字节）。超过上限不解析，直接提示下载：
 * Word / 表格 / 演示文稿要在内存里整份解压和建 DOM，手机 WebView 上过大会卡死或被系统杀掉。
 * 文本、压缩包、音视频按需分段读取，不设上限。
 */
export const PREVIEW_LIMITS: Partial<Record<PreviewKind, number>> = {
  docx: 20 * MB,
  sheet: 15 * MB,
  pptx: 40 * MB,
  image: 30 * MB,
  svg: 5 * MB,
};
/** CSV 是纯文本，整份解析成表格比二进制 xlsx 更耗内存，单独限制 */
export const CSV_LIMIT = 10 * MB;
/** 文本类只读取并显示前 1 MB */
export const TEXT_PREVIEW_BYTES = 1 * MB;
/** 表格：每个工作表最多解析 / 显示的行、列和单元格数 */
export const SHEET_MAX_ROWS = 1000;
export const SHEET_MAX_COLS = 100;
export const SHEET_MAX_CELLS = 40_000;
/** 演示文稿最多渲染的页数 */
export const PPTX_MAX_SLIDES = 300;
/** 压缩包最多列出的条目数 */
export const ZIP_MAX_ENTRIES = 5000;

const EXT: Record<string, Exclude<PreviewKind, "unsupported">> = {};
const LABEL: Record<string, string> = {};
function reg(kind: Exclude<PreviewKind, "unsupported">, label: string, exts: string[]) {
  for (const e of exts) {
    EXT[e] = kind;
    LABEL[e] = label;
  }
}
reg("pdf", "PDF", ["pdf"]);
reg("docx", "Word 文档", ["docx"]);
reg("sheet", "表格", ["xlsx", "xlsm", "xls", "ods"]);
reg("sheet", "CSV 表格", ["csv", "tsv"]);
reg("pptx", "演示文稿", ["pptx", "ppsx"]);
reg("markdown", "Markdown", ["md", "markdown"]);
reg("json", "JSON", ["json"]);
reg("text", "文本", ["txt", "log", "text"]);
reg("text", "配置文件", ["xml", "yaml", "yml", "ini", "conf", "cfg", "toml", "properties", "env", "gitignore", "editorconfig"]);
reg("text", "代码", [
  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "vue", "svelte",
  "py", "java", "kt", "kts", "scala", "groovy", "gradle", "go", "rs", "c", "h", "cpp", "cc", "cxx", "hpp", "hh", "cs",
  "swift", "m", "mm", "rb", "php", "pl", "lua", "r", "dart", "sql", "sh", "bash", "zsh", "ps1", "bat", "cmd",
  "css", "scss", "sass", "less", "html", "htm", "xhtml",
]);
reg("image", "图片", ["png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "avif"]);
reg("svg", "SVG 图片", ["svg"]);
reg("video", "视频", ["mp4", "m4v", "webm", "mov", "ogv"]);
reg("audio", "音频", ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac"]);
reg("zip", "压缩包", ["zip"]);

/** 已知但不能在页内预览的类型：给出具体原因 */
const KNOWN_UNSUPPORTED: Record<string, { label: string; title: string; detail: string }> = {};
function unsupported(exts: string[], label: string, title: string, detail: string) {
  for (const e of exts) KNOWN_UNSUPPORTED[e] = { label, title, detail };
}
unsupported(["doc", "dot"], "Word 97-2003 文档", "暂不支持预览旧版 Word 文档（.doc）", "这是 Word 97-2003 的二进制格式，浏览器里无法可靠解析。可以下载后用 Office / WPS 打开，或另存为 .docx 后重新发送。");
unsupported(["ppt", "pps", "pot"], "PowerPoint 97-2003 演示文稿", "暂不支持预览旧版 PowerPoint 文件（.ppt）", "这是 PowerPoint 97-2003 的二进制格式，浏览器里无法可靠解析。可以下载后用 Office / WPS 打开，或另存为 .pptx 后重新发送。");
unsupported(["wps", "wpt", "et", "ett", "dps", "dpt"], "WPS 文件", "暂不支持预览 WPS 专有格式", "可以下载后用 WPS 打开，或在 WPS 里另存为 .docx / .xlsx / .pptx 后重新发送。");
unsupported(["rtf"], "RTF 文档", "暂不支持预览 RTF 文档", "可以下载后用 Word / WPS 打开。");
unsupported(["rar", "7z", "tar", "gz", "tgz", "bz2", "xz"], "压缩包", "只支持查看 ZIP 压缩包的目录", "RAR / 7z / tar 等格式需要下载后用解压软件查看。");
unsupported(["pages", "key", "numbers"], "Apple iWork 文件", "暂不支持预览 iWork 文件", "可以下载后用 Pages / Keynote / Numbers 打开，或导出为 Office 格式后重新发送。");
unsupported(["vsd", "vsdx", "mpp", "dwg", "dxf", "psd", "ai", "sketch", "xmind"], "专业软件文件", "暂不支持预览该类型文件", "这种格式需要专门的软件打开，请下载后查看。");
unsupported(["heic", "heif", "tif", "tiff"], "图片", "当前设备可能无法显示该图片格式", "HEIC / TIFF 图片在多数浏览器和 WebView 里不能直接显示，请下载后用相册或看图软件查看。");
unsupported(["avi", "wmv", "flv", "mkv", "rm", "rmvb", "3gp"], "视频", "暂不支持在页内播放该视频格式", "浏览器和 WebView 只能播放 MP4 / WebM 等格式，请下载后用播放器打开。");
unsupported(["wma", "amr", "ape"], "音频", "暂不支持在页内播放该音频格式", "请下载后用播放器打开。");
unsupported(["exe", "msi", "apk", "dmg", "iso", "bin", "dll", "so"], "程序或镜像文件", "该类型文件不能预览", "安装包、程序和磁盘镜像只能下载。");

const MIME: Record<string, Exclude<PreviewKind, "unsupported">> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.ms-excel": "sheet",
  "text/csv": "sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/markdown": "markdown",
  "application/json": "json",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "image/svg+xml": "svg",
};

export function fileExtension(fileName: string | null | undefined): string {
  const base = (fileName ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "";
  // ".gitignore" 这种只有扩展名的文件名也按扩展名处理
  return base.slice(dot + 1).toLowerCase();
}

export function baseMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0].trim().toLowerCase();
}

const KIND_LABEL: Record<Exclude<PreviewKind, "unsupported">, string> = {
  pdf: "PDF",
  docx: "Word 文档",
  sheet: "表格",
  pptx: "演示文稿",
  markdown: "Markdown",
  json: "JSON",
  text: "文本",
  image: "图片",
  svg: "SVG 图片",
  video: "视频",
  audio: "音频",
  zip: "压缩包",
};

/** 判断文件用哪种方式预览：扩展名优先（上传时浏览器给的 MIME 经常是空的或不准），没有扩展名时看 MIME */
export function resolvePreview(input: { fileName?: string | null; mimeType?: string | null }): PreviewInfo {
  const ext = fileExtension(input.fileName);
  const byExt = EXT[ext];
  if (byExt) return { kind: byExt, ext, label: LABEL[ext], reason: null };
  const known = KNOWN_UNSUPPORTED[ext];
  if (known) return { kind: "unsupported", ext, label: known.label, reason: { title: known.title, detail: known.detail } };
  if (!ext) {
    const mime = baseMime(input.mimeType);
    let kind: PreviewKind | undefined = MIME[mime];
    if (!kind) {
      if (/^image\/(png|jpeg|gif|webp|bmp|avif|x-icon)$/.test(mime)) kind = "image";
      else if (/^video\/(mp4|webm|ogg|quicktime)$/.test(mime)) kind = "video";
      else if (/^audio\//.test(mime)) kind = "audio";
      else if (mime === "text/plain") kind = "text";
    }
    if (kind) return { kind, ext, label: KIND_LABEL[kind], reason: null };
  }
  return { kind: "unsupported", ext, label: ext ? `.${ext} 文件` : "文件", reason: null };
}

/** 超过前端安全预览上限时返回上限（字节），否则 null */
export function previewLimit(info: Pick<PreviewInfo, "kind" | "ext">): number | null {
  if (info.kind === "sheet" && (info.ext === "csv" || info.ext === "tsv")) return CSV_LIMIT;
  return PREVIEW_LIMITS[info.kind] ?? null;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

export type PreviewDecision =
  /** 页内预览 */
  | { mode: "preview"; info: PreviewInfo }
  /** 打开预览窗口但只显示原因和下载按钮（旧版格式、超过大小上限） */
  | { mode: "fallback"; info: PreviewInfo; reason: { title: string; detail: string } }
  /** 未知类型：保持原来的点击直接下载 */
  | { mode: "download"; info: PreviewInfo };

export function decidePreview(input: { fileName?: string | null; mimeType?: string | null; size?: number | null }): PreviewDecision {
  const info = resolvePreview(input);
  if (info.kind === "unsupported") {
    return info.reason ? { mode: "fallback", info, reason: info.reason } : { mode: "download", info };
  }
  const limit = previewLimit(info);
  const size = Number(input.size) || 0;
  if (limit !== null && size > limit) {
    return {
      mode: "fallback",
      info,
      reason: {
        title: "文件较大，暂不支持在线预览",
        detail: `${info.label}超过 ${formatBytes(limit)} 时不在页内打开（当前 ${formatBytes(size)}），以免手机卡顿或内存不足。请下载后查看。`,
      },
    };
  }
  return { mode: "preview", info };
}

/** 深色背景的预览（PDF、图片、音视频），其余（文档、表格、文本等）用浅色背景 */
export function isDarkPreview(kind: PreviewKind): boolean {
  return kind === "pdf" || kind === "image" || kind === "svg" || kind === "video" || kind === "audio";
}

/** 页内播放用的 MIME（文件接口按它返回 Content-Type，带 Range） */
export const MEDIA_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
};

export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};
