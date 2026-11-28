/**
 * 手机 App 版本号规则（与 Web 版本统一维护，见 docs/mobile/BUILD.md）：
 * - versionName = 根目录 package.json 的 version，只允许 X.Y.Z（0 ≤ Y、Z ≤ 99）；
 * - versionCode = X × 10000 + Y × 100 + Z，例如 0.1.0 → 100、1.2.3 → 10203。
 * mobile/android/app/build.gradle 用同一公式生成 versionCode，两处必须一致。
 */
const VERSION_RE = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/;

export function versionCodeOf(versionName: string): number | null {
  const m = VERSION_RE.exec(versionName.trim());
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

export function versionNameOf(versionCode: number): string {
  const major = Math.floor(versionCode / 10000);
  const minor = Math.floor((versionCode % 10000) / 100);
  return `${major}.${minor}.${versionCode % 100}`;
}

export type MobileUpdateStatus = "none" | "optional" | "required";

/** 当前版本低于最低支持版本 → 强制更新；低于最新版本 → 提示更新 */
export function mobileUpdateStatus(current: number, latest: number, min: number): MobileUpdateStatus {
  if (current < min) return "required";
  if (current < latest) return "optional";
  return "none";
}

/** /api/mobile/version 的响应 */
export type MobileVersionInfo =
  | { available: false }
  | {
      available: true;
      versionCode: number;
      versionName: string;
      minVersionCode: number;
      minVersionName: string;
      /** 绝对地址，按当前请求的主机生成 */
      downloadUrl: string;
      pageUrl: string;
      size: number;
      sha256: string;
      notes: string;
      publishedAt: string;
      /** 请求带 ?current=<versionCode> 时给出 */
      update?: MobileUpdateStatus;
    };
