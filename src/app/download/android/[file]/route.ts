import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { APK_MIME, readMobileRelease } from "@/lib/mobile-release";

/**
 * 下载 Android 安装包（无需登录）。只提供 release.json 里登记的那个文件；`latest.apk` 指向当前最新版。
 * 支持单段 Range：系统下载器断网后会续传。
 */
function serve(req: NextRequest, fileParam: string, head: boolean): Response {
  const result = readMobileRelease();
  if (!result.ok) return new Response("未发布 Android 安装包", { status: 404 });
  const { release, apkPath } = result;
  const name = decodeURIComponent(fileParam);
  if (name !== release.file && name !== "latest.apk") return new Response("not found", { status: 404 });

  const size = fs.statSync(apkPath).size;
  const etag = `"${release.sha256}"`;
  const headers: Record<string, string> = {
    "Content-Type": APK_MIME,
    "Content-Disposition": `attachment; filename="${release.file}"`,
    "Accept-Ranges": "bytes",
    ETag: etag,
    // 文件名带版本号，内容不会变；latest.apk 会随发布变化
    "Cache-Control": name === "latest.apk" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  if (range && (!ifRange || ifRange === etag)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === "" && m[2] === "")) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    if (m[1] === "") {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== "") end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  if (head) return new Response(null, { status, headers });
  const stream = Readable.toWeb(fs.createReadStream(apkPath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/download/android/[file]">) {
  return serve(req, (await ctx.params).file, false);
}

export async function HEAD(req: NextRequest, ctx: RouteContext<"/download/android/[file]">) {
  return serve(req, (await ctx.params).file, true);
}
