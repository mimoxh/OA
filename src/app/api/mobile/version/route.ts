import { NextResponse, type NextRequest } from "next/server";
import { buildVersionInfo, readMobileRelease, requestOrigin } from "@/lib/mobile-release";

/**
 * 手机 App 检查更新（无需登录，见 src/proxy.ts PUBLIC_PATHS）。
 * ?current=<versionCode> 时额外返回 update: none / optional / required。
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("current");
  const current = raw != null && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const info = buildVersionInfo(readMobileRelease(), requestOrigin(req.headers, req.url), current);
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
