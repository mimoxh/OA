import { unlink } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { unzipSync } from "fflate";
import { db } from "@/lib/db";
import { getCurrentUser, isAppEnabled } from "@/lib/auth/dal";
import { getDocAccess, getSpaceAccess } from "@/lib/docs/access";
import { attachmentPath, storeAttachment } from "@/lib/docs/attachments";
import { extractText, type JSONNode } from "@/lib/docs/content";
import { syncDocumentLinks } from "@/lib/docs/links";
import { checkDoc, finalizeImportedDoc, markdownToDoc, type AttachmentInfo, type ResolvedRef, type WikiLinkResolution } from "@/lib/docs/markdown";
import { audit } from "@/lib/services/notify";

const err = (error: string, status: number, extra?: object) => NextResponse.json({ error, ...extra }, { status });

const REQUEST_MAX = 50 * 1024 * 1024;
const MD_MAX = 1024 * 1024;
const PAGE_MAX = 500;
const ZIP_ENTRIES_MAX = 2000;
const ZIP_UNPACKED_MAX = 100 * 1024 * 1024;

const MD_EXT = /\.(?:md|markdown|txt)$/i;
const COLLATOR = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

class ImportError extends Error {}

/** 归一化包内路径：拒绝绝对路径、盘符、.. 段与 NUL */
function normalizeEntryPath(raw: string): string | null {
  const s = raw.replace(/\\/g, "/");
  if (/\0/.test(s) || s.startsWith("/") || /^[a-zA-Z]:/.test(s)) return null;
  const parts = s.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === "..")) return null;
  return parts.join("/");
}

type Entry = { bytes: Uint8Array };
type Package = { id: string; name: string; files: Map<string, Entry> };

function isSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === req.nextUrl.origin;
  } catch {
    return false;
  }
}

const pageKey = (pkgId: string, kind: "file" | "folder", p: string) => `${pkgId}\0${kind}:${p}`;

function readZip(id: string, name: string, bytes: Uint8Array): Package {
  if (bytes.byteLength > ZIP_UNPACKED_MAX) throw new ImportError(`ZIP 文件过大：${name}`);
  let count = 0;
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        count += 1;
        if (count > ZIP_ENTRIES_MAX) throw new ImportError(`ZIP 条目超过 2000 个：${name}`);
        total += f.originalSize;
        if (total > ZIP_UNPACKED_MAX) throw new ImportError(`ZIP 解压后超过 100MB 限制：${name}`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`ZIP 文件已损坏或格式无效：${name}`);
  }
  let actualTotal = 0;
  const map = new Map<string, Entry>();
  for (const [raw, data] of Object.entries(files)) {
    actualTotal += data.byteLength;
    if (actualTotal > ZIP_UNPACKED_MAX) throw new ImportError(`ZIP 解压后超过 100MB 限制：${name}`);
    if (raw.endsWith("/") || raw.startsWith("__MACOSX/")) continue;
    const p = normalizeEntryPath(raw);
    if (!p) throw new ImportError(`ZIP 包含非法路径：${raw.slice(0, 80)}`);
    const base = p.split("/").pop()!;
    if (base.startsWith(".")) continue;
    map.set(p, { bytes: data });
  }
  return { id, name, files: map };
}

// ───────────── 页面清单解析 ─────────────

type PagePlan = {
  key: string;
  file: string | null; // md 文件路径（伪页面为 null）
  parentKey: string | null;
  title?: string;
  icon?: string | null;
};

function manifestPages(pkg: Package, manifest: Record<string, unknown>): { pages: PagePlan[]; attNames: Map<string, string> } | null {
  const attNames = new Map<string, string>();
  const attList = Array.isArray(manifest.attachments) ? manifest.attachments : [];
  for (const a of attList) {
    if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      if (typeof o.path === "string" && typeof o.fileName === "string") {
        const p = normalizeEntryPath(o.path);
        if (p) attNames.set(p, o.fileName);
      }
    }
  }

  if (manifest.format === "oa-docs-export-v1" || manifest.format === "nbase-subtree-export-v1") {
    if (!Array.isArray(manifest.pages)) throw new ImportError("导出清单缺少页面列表");
    const pages: PagePlan[] = [];
    const paths = new Set<string>();
    for (const item of manifest.pages) {
      const o = item as Record<string, unknown>;
      if (!o || typeof o.path !== "string" || typeof o.title !== "string") throw new ImportError("导出清单页面格式无效");
      const p = normalizeEntryPath(o.path);
      if (!p || !MD_EXT.test(p) || !pkg.files.has(p)) throw new ImportError(`导出清单缺少页面文件：${String(o.path).slice(0, 80)}`);
      if (paths.has(p)) throw new ImportError(`导出清单存在重复页面路径：${p.slice(0, 80)}`);
      const parentPath = typeof o.parentPath === "string" ? normalizeEntryPath(o.parentPath) : null;
      pages.push({
        key: pageKey(pkg.id, "file", p),
        file: p,
        parentKey: parentPath ? pageKey(pkg.id, "file", parentPath) : null,
        title: o.title,
        icon: typeof o.icon === "string" ? o.icon.slice(0, 16) : null,
      });
      paths.add(p);
    }
    const prefix = `${pkg.id}\0file:`;
    for (const p of pages) {
      const pp = p.parentKey?.slice(prefix.length);
      if (pp && !paths.has(pp)) throw new ImportError(`导出清单父页面不存在：${pp.slice(0, 80)}`);
    }
    return { pages, attNames };
  }

  if (manifest.format === "nbase-page-export-v1") {
    if (!pkg.files.has("document.md")) throw new ImportError("NBase 单页导出缺少 document.md");
    // NBase 单页清单的 attachments 形如 {id, mediaType, fileName}
    const extOf = (mt: string) =>
      ({ "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "application/pdf": ".pdf", "application/zip": ".zip", "text/plain": ".txt", "text/markdown": ".md" })[mt] ?? "";
    for (const a of attList) {
      const o = a as Record<string, unknown>;
      if (o && typeof o.id === "string" && typeof o.mediaType === "string" && typeof o.fileName === "string") {
        const p = `attachments/${o.id.toLowerCase()}${extOf(o.mediaType)}`;
        attNames.set(p, o.fileName);
      }
    }
    return { pages: [{ key: pageKey(pkg.id, "file", "document.md"), file: "document.md", parentKey: null }], attNames };
  }

  return null;
}

function genericPages(pkg: Package): PagePlan[] {
  const mdFiles = [...pkg.files.keys()].filter((p) => MD_EXT.test(p));
  const pages = new Map<string, PagePlan>();
  const folderKey = (dir: string): string | null => {
    if (!dir) return null;
    if (pkg.files.has(`${dir}.md`)) return pageKey(pkg.id, "file", `${dir}.md`);
    return pageKey(pkg.id, "folder", dir);
  };
  const ensureFolder = (dir: string) => {
    const key = folderKey(dir);
    if (!key || pages.has(key)) return;
    const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
    ensureFolder(parent);
    if (key.includes("\0folder:")) {
      pages.set(key, { key, file: null, parentKey: folderKey(parent), title: dir.split("/").pop() });
    } else {
      pages.set(key, { key, file: `${dir}.md`, parentKey: folderKey(parent) });
    }
  };
  for (const file of mdFiles) {
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    ensureFolder(dir);
    const key = pageKey(pkg.id, "file", file);
    pages.set(key, { key, file, parentKey: folderKey(dir) });
  }
  // 同级自然排序：按父分组排序后展开
  const groups = new Map<string | null, PagePlan[]>();
  for (const p of pages.values()) {
    if (!groups.has(p.parentKey)) groups.set(p.parentKey, []);
    groups.get(p.parentKey)!.push(p);
  }
  const ordered: PagePlan[] = [];
  const emit = (parent: string | null) => {
    const list = (groups.get(parent) ?? []).sort((a, b) => COLLATOR.compare(a.file ?? a.title ?? "", b.file ?? b.title ?? ""));
    for (const p of list) {
      ordered.push(p);
      emit(p.key);
    }
  };
  emit(null);
  return ordered;
}

// ───────────── 引用收集 ─────────────

const LINK_RE = /^\/docs\/([\w-]+)$/;
const ATT_RE = /^\/api\/docs\/attachments\/([0-9a-f-]{36})(\?download=1)?$/i;
const REL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** 收集 JSON 中出现的所有链接/图片目标 */
function collectRefs(json: JSONNode, hrefs: Set<string>, images: Set<string>) {
  const walk = (n: JSONNode) => {
    if (n.marks) for (const m of n.marks) if (m.type === "link" && typeof m.attrs?.href === "string") hrefs.add(m.attrs.href);
    if (n.type === "image" && typeof n.attrs?.src === "string") images.add(n.attrs.src);
    n.content?.forEach(walk);
  };
  walk(json);
}

/** 相对 href → 包内路径（相对所在 md 文件的目录） */
function resolveLocalKey(fromFile: string | null, href: string): string | null {
  const base = fromFile && fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")).split("/") : [];
  const clean = href.split("#")[0].split("?")[0];
  for (const rawSeg of clean.split("/")) {
    if (!rawSeg || rawSeg === ".") continue;
    let seg: string;
    try {
      seg = decodeURIComponent(rawSeg);
    } catch {
      seg = rawSeg;
    }
    if (seg === "..") {
      if (!base.pop()) return null;
    } else base.push(seg);
  }
  return base.join("/");
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return err("未登录", 401);
  if (!isSameOrigin(req)) return err("非法请求来源", 403);
  if (!(await isAppEnabled("docs"))) return err("「文档」应用已停用", 403);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > REQUEST_MAX + 256 * 1024) return err("请求超过 50MB 限制", 413);

  const form = await req.formData().catch(() => null);
  if (!form) return err("请求格式不正确", 400);
  const spaceId = String(form.get("spaceId") ?? "");
  const parentId = form.get("parentId") ? String(form.get("parentId")) : null;
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!spaceId || uploads.length === 0) return err("缺少文件或空间", 400);

  const access = await getSpaceAccess(user, spaceId);
  if (!access || !access.access.canEdit) return err("没有权限导入到该空间", 403);
  if (parentId) {
    const parent = await db.document.findUnique({ where: { id: parentId }, select: { spaceId: true, deletedAt: true, kind: true } });
    if (!parent || parent.spaceId !== spaceId || parent.deletedAt) return err("父页面不存在", 400);
    if (parent.kind === "whiteboard") return err("白板下不能导入子页面", 400);
  }

  // ── 解包 ──
  let packages: Package[];
  try {
    const loose: Package = { id: "__loose__", name: "上传文件", files: new Map() };
    const zips: Package[] = [];
    let uploadTotal = 0;
    for (const f of uploads) {
      uploadTotal += f.size;
      if (uploadTotal > REQUEST_MAX) return err("请求超过 50MB 限制", 413);
      const lower = f.name.toLowerCase();
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (MD_EXT.test(lower)) {
        const rawBase = f.name.split("/").pop()!.split("\\").pop()!;
        let name = rawBase;
        if (loose.files.has(name)) {
          const m = /^(.*?)(\.(?:md|markdown|txt))$/i.exec(rawBase);
          const stem = m ? m[1] : rawBase;
          const ext = m ? m[2] : "";
          for (let i = 2; loose.files.has(name); i++) name = `${stem} (${i})${ext}`;
        }
        loose.files.set(name, { bytes });
      } else if (lower.endsWith(".zip")) {
        const pkg = readZip(`zip:${f.name}:${zips.length}`, f.name, bytes);
        zips.push(pkg);
      } else return err(`不支持的文件类型：${f.name}`, 400);
    }
    packages = [...(loose.files.size ? [loose] : []), ...zips];
  } catch (e) {
    if (e instanceof ImportError) return err(e.message, 400);
    throw e;
  }

  // ── 解析页面清单 ──
  type ParsedPage = PagePlan & {
    pkg: Package;
    json: JSONNode;
    title: string;
    icon: string | null;
    warnings: string[];
  };
  const plans: ParsedPage[] = [];
  const allWarnings: { file: string; message: string }[] = [];
  const fileErrors: { file: string; message: string }[] = [];

  try {
    for (const pkg of packages) {
      const manifestEntry = pkg.files.get("manifest.json");
      let manifest: Record<string, unknown> | null = null;
      if (manifestEntry) {
        try {
          const v: unknown = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
          if (v && typeof v === "object" && !Array.isArray(v)) manifest = v as Record<string, unknown>;
        } catch {}
      }
      const { pages, attNames } = manifest ? (manifestPages(pkg, manifest) ?? { pages: genericPages(pkg), attNames: new Map<string, string>() }) : { pages: genericPages(pkg), attNames: new Map<string, string>() };
      (pkg as Package & { attNames: Map<string, string> }).attNames = attNames;
      if (plans.length + pages.length > PAGE_MAX) throw new ImportError(`一次最多导入 ${PAGE_MAX} 个页面`);

      for (const plan of pages) {
        const parsed: ParsedPage = { ...plan, pkg, json: { type: "doc", content: [{ type: "paragraph" }] }, title: plan.title ?? "", icon: plan.icon ?? null, warnings: [] };
        plans.push(parsed);
        if (!plan.file) {
          parsed.title = parsed.title || "无标题";
          continue;
        }
        const entry = pkg.files.get(plan.file)!;
        if (entry.bytes.byteLength > MD_MAX) {
          fileErrors.push({ file: plan.file, message: "Markdown 文件超过 1MB 限制" });
          continue;
        }
        let md: string;
        try {
          md = new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes);
        } catch {
          fileErrors.push({ file: plan.file, message: "文件须使用 UTF-8 编码" });
          continue;
        }
        try {
          const r = markdownToDoc(md, { fileName: plan.file });
          parsed.json = r.json;
          parsed.title = plan.title ?? r.title ?? "无标题";
          parsed.icon = plan.icon ?? r.icon ?? null;
          if (r.ignoredMeta.length) parsed.warnings.push(`已忽略元数据：${r.ignoredMeta.join("、")}`);
          parsed.warnings.push(...r.warnings);
        } catch (e) {
          fileErrors.push({ file: plan.file, message: `解析失败：${e instanceof Error ? e.message : String(e)}` });
        }
      }
    }
  } catch (e) {
    if (e instanceof ImportError) return err(e.message, 400);
    throw e;
  }
  if (fileErrors.length) return err("导入失败：存在无法解析的文件", 400, { errors: fileErrors });

  // ── 引用预检（/docs/<id>、站内附件、相对目标归类） ──
  const hrefs = new Set<string>();
  const images = new Set<string>();
  for (const p of plans) collectRefs(p.json, hrefs, images);

  const docIds = new Set([...hrefs].map((h) => LINK_RE.exec(h)?.[1]).filter((x): x is string => !!x));
  const readableDocs = new Set<string>();
  for (const id of docIds) {
    const r = await getDocAccess(user, id);
    if (r?.canRead) readableDocs.add(id);
  }
  const attIds = new Set([...hrefs, ...images].map((h) => ATT_RE.exec(h)?.[1]).filter((x): x is string => !!x));
  const ownedAtts = new Map<string, AttachmentInfo>();
  if (attIds.size) {
    const rows = await db.attachment.findMany({ where: { id: { in: [...attIds] }, spaceId } });
    for (const r of rows) ownedAtts.set(r.id, { id: r.id, fileName: r.fileName, mediaType: r.mediaType, size: r.size });
  }

  // 相对引用 → 包内路径归类；附件候选记录首个引用页面
  // 只有“真实页面计划”内的文件才算页面引用（attachments/*.txt 等按附件处理）
  const pageFileKeys = new Set(plans.filter((p) => p.file).map((p) => pageKey(p.pkg.id, "file", p.file!)));
  const attFirstRef = new Map<string, string>(); // "pkgId\0entry" -> pageKey
  const localKeys = new Map<string, string>(); // "pageKey\0href" -> entry key
  for (const p of plans) {
    const refs = new Set<string>();
    collectRefs(p.json, refs, refs);
    for (const href of refs) {
      if (REL_RE.test(href) || href.startsWith("#") || href.startsWith("//") || href.startsWith("/") || /[\\\x00-\x1f\x7f]/.test(href)) continue;
      const key = resolveLocalKey(p.file, href);
      if (!key) continue;
      localKeys.set(`${p.key}\0${href}`, key);
      if (p.pkg.files.has(key) && !pageFileKeys.has(pageKey(p.pkg.id, "file", key))) {
        const k = `${p.pkg.id}\0${key}`;
        if (!attFirstRef.has(k)) attFirstRef.set(k, p.key);
      }
    }
  }

  // ── 事务：建页 → 存附件 → 定稿内容 ──
  const storedFiles: string[] = [];
  try {
    const result = await db.$transaction(
      async (tx) => {
        const newIds = new Map<string, string>();
        const sortBase = new Map<string | null, number>();
        const nextSort = async (pid: string | null) => {
          if (!sortBase.has(pid)) {
            const last = await tx.document.findFirst({
              where: { spaceId, parentId: pid, deletedAt: null, isTemplate: false },
              orderBy: { sortOrder: "desc" },
              select: { sortOrder: true },
            });
            sortBase.set(pid, (last?.sortOrder ?? -1) + 1);
          }
          const v = sortBase.get(pid)!;
          sortBase.set(pid, v + 1);
          return v;
        };

        // 父先子后创建
        const pending = new Map(plans.map((p) => [p.key, p]));
        let guard = plans.length * 2 + 2;
        while (pending.size && guard-- > 0) {
          for (const [key, p] of pending) {
            const parentDocId = p.parentKey ? newIds.get(p.parentKey) : parentId;
            if (p.parentKey && !newIds.has(p.parentKey)) continue;
            const row = await tx.document.create({
              data: {
                spaceId,
                parentId: parentDocId ?? null,
                title: p.title,
                icon: p.icon,
                content: '{"type":"doc","content":[]}',
                text: "",
                sortOrder: await nextSort(parentDocId ?? null),
                createdById: user.id,
                updatedById: user.id,
              },
            });
            newIds.set(key, row.id);
            pending.delete(key);
          }
        }
        if (pending.size) throw new ImportError("导入页面层级存在循环");

        // 存附件（同一包内条目只存一次，documentId = 首个引用页面）
        const attMap = new Map<string, AttachmentInfo>(); // "pkgId\0entry" -> 附件
        const attNames = (pkg: Package) => (pkg as Package & { attNames?: Map<string, string> }).attNames ?? new Map<string, string>();
        const pkgById = new Map(packages.map((pkg) => [pkg.id, pkg]));
        for (const [k, pKey] of attFirstRef) {
          const [pkgId, key] = k.split("\0");
          const pkg = pkgById.get(pkgId)!;
          const docId = newIds.get(pKey) ?? null;
          const entry = pkg.files.get(key)!;
          const attName = attNames(pkg).get(key) ?? key.split("/").pop()!;
          try {
            const att = await storeAttachment({ bytes: entry.bytes, fileName: attName, spaceId, documentId: docId, userId: user.id }, tx);
            attMap.set(k, { id: att.id, fileName: att.fileName, mediaType: att.mediaType, size: att.size });
            storedFiles.push(att.id);
          } catch (e) {
            allWarnings.push({ file: key, message: e instanceof Error ? e.message : "附件存储失败" });
          }
        }

        // 双链标题索引：优先匹配本次导入批次内的唯一标题，其次匹配目标空间现有活跃页面的唯一标题
        const normTitle = (s: string) => s.trim().toLowerCase();
        const addTitle = (map: Map<string, string[]>, title: string, id: string) => {
          const k = normTitle(title);
          if (!k) return;
          const list = map.get(k);
          if (list) list.push(id);
          else map.set(k, [id]);
        };
        const batchByTitle = new Map<string, string[]>();
        const batchIdList = [...newIds.values()];
        for (const p of plans) addTitle(batchByTitle, p.title, newIds.get(p.key)!);
        const existingDocs = await tx.document.findMany({
          where: { spaceId, deletedAt: null, isTemplate: false, id: { notIn: batchIdList } },
          select: { id: true, title: true },
        });
        const spaceByTitle = new Map<string, string[]>();
        for (const d of existingDocs) addTitle(spaceByTitle, d.title, d.id);

        const resolveWikiLink = (target: string): WikiLinkResolution => {
          const k = normTitle(target);
          if (!k) return { kind: "not_found" };
          const inBatch = batchByTitle.get(k);
          if (inBatch) return inBatch.length === 1 ? { kind: "doc", docId: inBatch[0] } : { kind: "ambiguous" };
          const inSpace = spaceByTitle.get(k);
          if (inSpace) return inSpace.length === 1 ? { kind: "doc", docId: inSpace[0] } : { kind: "ambiguous" };
          return { kind: "not_found" };
        };

        // 定稿每页内容并同步双链索引
        const rootIds: string[] = [];
        const created: { id: string; title: string; parentId: string | null }[] = [];
        for (const p of plans) {
          const docId = newIds.get(p.key)!;
          const parentDocId = p.parentKey ? newIds.get(p.parentKey)! : parentId;
          if (!p.parentKey) rootIds.push(docId);
          created.push({ id: docId, title: p.title, parentId: parentDocId ?? null });

          const resolvers = {
            resolveLocal: (href: string): ResolvedRef => {
              const key = localKeys.get(`${p.key}\0${href}`) ?? resolveLocalKey(p.file, href);
              if (!key) return { kind: "drop", reason: `无法解析的引用：${href.slice(0, 80)}` };
              const att = attMap.get(`${p.pkg.id}\0${key}`);
              if (att) return { kind: "attachment", attachment: att };
              const targetKey = pageKey(p.pkg.id, "file", key);
              if (pageFileKeys.has(targetKey)) {
                const target = newIds.get(targetKey);
                if (target) return { kind: "doc", docId: target };
              }
              return { kind: "drop", reason: `无法解析的引用：${href.slice(0, 80)}` };
            },
            checkDocLink: (id: string) => readableDocs.has(id),
            checkAttachment: (id: string) => ownedAtts.get(id) ?? null,
            resolveWikiLink,
          };
          const warnings: string[] = [];
          const json = finalizeImportedDoc(p.json, resolvers, warnings);
          try {
            checkDoc(json);
          } catch {
            throw new ImportError(`页面内容校验失败：${p.file ?? p.title}`);
          }
          await tx.document.update({ where: { id: docId }, data: { content: JSON.stringify(json), text: extractText(json) } });
          await syncDocumentLinks(tx, docId, json, { isTemplate: false });
          for (const w of [...p.warnings, ...warnings]) allWarnings.push({ file: p.file ?? p.title, message: w });
        }
        for (const rootId of rootIds) await audit(tx, { entityType: "document", entityId: rootId, action: "import", userId: user.id });
        return { created, rootIds };
      },
      { timeout: 60_000 },
    );
    revalidatePath("/", "layout");
    return NextResponse.json({ ...result, warnings: allWarnings });
  } catch (e) {
    for (const id of storedFiles) await unlink(attachmentPath(id)).catch(() => {});
    if (e instanceof ImportError) return err(e.message, 400, { warnings: allWarnings });
    throw e;
  }
}
