import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mobileUpdateStatus, versionNameOf, type MobileVersionInfo } from "./mobile-version";

/**
 * Android 安装包的发布目录：release.json + APK 文件，由 `pnpm mobile:publish` 写入（scripts/mobile/publish-apk.mjs）。
 * 目录不在镜像里：NAS 容器挂载到 /data/mobile，桌面一体包放在数据目录下的 mobile/。
 */
export function mobileReleaseDir(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  const explicit = env.MOBILE_RELEASE_DIR?.trim();
  if (explicit) return path.resolve(cwd, explicit);
  const dataDir = env.OA_DATA_DIR?.trim();
  if (dataDir) return path.resolve(cwd, dataDir, "mobile");
  return path.resolve(cwd, "data", "mobile");
}

export const RELEASE_FILE = "release.json";
export const APK_MIME = "application/vnd.android.package-archive";

const releaseSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string().min(1),
  minVersionCode: z.number().int().nonnegative().default(0),
  // 只允许发布目录里的纯文件名，避免 release.json 被改成任意路径
  file: z.string().regex(/^[\w.-]+\.apk$/),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  notes: z.string().default(""),
  publishedAt: z.string().default(""),
  certSha256: z.string().optional(),
});

export type MobileRelease = z.infer<typeof releaseSchema>;

export type ReadReleaseResult = { ok: true; release: MobileRelease; apkPath: string } | { ok: false; reason: "missing" | "invalid" | "apk-missing" };

export function readMobileRelease(dir = mobileReleaseDir()): ReadReleaseResult {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, RELEASE_FILE), "utf8");
  } catch {
    return { ok: false, reason: "missing" };
  }
  let parsed: MobileRelease;
  try {
    const r = releaseSchema.safeParse(JSON.parse(raw));
    if (!r.success) return { ok: false, reason: "invalid" };
    parsed = r.data;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const apkPath = path.join(dir, parsed.file);
  if (!fs.existsSync(apkPath)) return { ok: false, reason: "apk-missing" };
  return { ok: true, release: parsed, apkPath };
}

/** 浏览器 / App 访问本服务用的源地址（经单端口网关或反代时取 X-Forwarded-*） */
export function requestOrigin(headers: Headers, fallbackUrl: string): string {
  const fallback = new URL(fallbackUrl);
  const host = headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host") || fallback.host;
  const proto = (headers.get("x-forwarded-proto") ?? fallback.protocol.replace(/:$/, "")).split(",")[0].trim();
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "::1" || h === "[::1]" || /^127\./.test(h);
  } catch {
    return false;
  }
}

export const DOWNLOAD_PAGE_PATH = "/download/android";

export function apkPath(release: Pick<MobileRelease, "file">): string {
  return `${DOWNLOAD_PAGE_PATH}/${encodeURIComponent(release.file)}`;
}

export function buildVersionInfo(result: ReadReleaseResult, origin: string, current: number | null): MobileVersionInfo {
  if (!result.ok) return { available: false };
  const r = result.release;
  // 最低支持版本不会高于最新版本，否则所有人都会被要求更新到一个不存在的版本
  const min = Math.min(r.minVersionCode, r.versionCode);
  return {
    available: true,
    versionCode: r.versionCode,
    versionName: r.versionName,
    minVersionCode: min,
    minVersionName: min > 0 ? versionNameOf(min) : "",
    downloadUrl: origin + apkPath(r),
    pageUrl: origin + DOWNLOAD_PAGE_PATH,
    size: r.size,
    sha256: r.sha256,
    notes: r.notes,
    publishedAt: r.publishedAt,
    ...(current != null ? { update: mobileUpdateStatus(current, r.versionCode, min) } : {}),
  };
}
