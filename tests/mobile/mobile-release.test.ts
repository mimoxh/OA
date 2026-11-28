import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";

import { GET as versionGET } from "@/app/api/mobile/version/route";
import { GET as apkGET, HEAD as apkHEAD } from "@/app/download/android/[file]/route";
import { buildVersionInfo, mobileReleaseDir, readMobileRelease, requestOrigin } from "@/lib/mobile-release";
import { mobileUpdateStatus, versionCodeOf, versionNameOf } from "@/lib/mobile-version";
import { proxy } from "@/proxy";

process.env.AUTH_SECRET ??= "test-secret-for-mobile-release-tests-0123456789";

const APK = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
const SHA = crypto.createHash("sha256").update(APK).digest("hex");

function writeRelease(dir: string, release: Record<string, unknown>, apk = true) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify(release));
  if (apk) fs.writeFileSync(path.join(dir, String(release.file)), APK);
}

const goodRelease = {
  versionCode: 10203,
  versionName: "1.2.3",
  minVersionCode: 10100,
  file: "oa-mobile-1.2.3.apk",
  size: APK.length,
  sha256: SHA,
  notes: "修复若干问题",
  publishedAt: "2026-11-26T08:00:00.000Z",
  certSha256: "AA:BB",
};

describe("手机 App 版本号规则", () => {
  it("versionCode = X*10000 + Y*100 + Z，只接受 X.Y.Z", () => {
    assert.equal(versionCodeOf("0.1.0"), 100);
    assert.equal(versionCodeOf("0.0.9"), 9);
    assert.equal(versionCodeOf("1.2.3"), 10203);
    assert.equal(versionCodeOf("12.99.99"), 129999);
    assert.equal(versionCodeOf("1.100.0"), null);
    assert.equal(versionCodeOf("1.2"), null);
    assert.equal(versionCodeOf("1.2.3-beta.1"), null);
    for (const v of ["0.1.0", "1.2.3", "3.0.12"]) assert.equal(versionNameOf(versionCodeOf(v)!), v);
  });

  it("与 build.gradle 使用同一公式", () => {
    const gradle = fs.readFileSync(path.resolve("mobile/android/app/build.gradle"), "utf8");
    assert.match(gradle, /\* 10000 \+ \(m\.group\(2\) as int\) \* 100 \+ \(m\.group\(3\) as int\)/);
    assert.match(gradle, /package\.json/);
  });

  it("低于最低版本强制更新，低于最新版本提示更新", () => {
    assert.equal(mobileUpdateStatus(9, 100, 50), "required");
    assert.equal(mobileUpdateStatus(60, 100, 50), "optional");
    assert.equal(mobileUpdateStatus(100, 100, 50), "none");
    assert.equal(mobileUpdateStatus(101, 100, 50), "none");
  });
});

describe("发布目录与 release.json", () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oa-mobile-rel-"));
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("目录：MOBILE_RELEASE_DIR → OA_DATA_DIR/mobile → ./data/mobile", () => {
    const cwd = path.resolve("/app");
    assert.equal(mobileReleaseDir({ MOBILE_RELEASE_DIR: "/srv/apk", OA_DATA_DIR: "/data" }, cwd), path.resolve("/srv/apk"));
    assert.equal(mobileReleaseDir({ OA_DATA_DIR: "/data" }, cwd), path.resolve("/data/mobile"));
    assert.equal(mobileReleaseDir({}, cwd), path.join(cwd, "data", "mobile"));
  });

  it("缺文件 / 格式错误 / 非法文件名 / 安装包缺失都视为未发布", () => {
    assert.deepEqual(readMobileRelease(path.join(tmp, "none")), { ok: false, reason: "missing" });

    const bad = path.join(tmp, "bad");
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, "release.json"), "{not json");
    assert.deepEqual(readMobileRelease(bad), { ok: false, reason: "invalid" });

    const traversal = path.join(tmp, "traversal");
    writeRelease(traversal, { ...goodRelease, file: "../secret.apk" }, false);
    assert.deepEqual(readMobileRelease(traversal), { ok: false, reason: "invalid" });

    const noApk = path.join(tmp, "noapk");
    writeRelease(noApk, goodRelease, false);
    assert.deepEqual(readMobileRelease(noApk), { ok: false, reason: "apk-missing" });

    const ok = path.join(tmp, "ok");
    writeRelease(ok, goodRelease);
    const r = readMobileRelease(ok);
    assert.equal(r.ok, true);
  });

  it("响应：绝对下载地址、最低版本不高于最新版本", () => {
    const ok = path.join(tmp, "ok2");
    writeRelease(ok, { ...goodRelease, minVersionCode: 99999 });
    const info = buildVersionInfo(readMobileRelease(ok), "https://oa.example.com", 100);
    assert.equal(info.available, true);
    if (!info.available) return;
    assert.equal(info.minVersionCode, 10203);
    assert.equal(info.minVersionName, "1.2.3");
    assert.equal(info.downloadUrl, "https://oa.example.com/download/android/oa-mobile-1.2.3.apk");
    assert.equal(info.pageUrl, "https://oa.example.com/download/android");
    assert.equal(info.update, "required");
    assert.equal("update" in buildVersionInfo(readMobileRelease(ok), "http://x", null), false);
  });

  it("源地址优先取反代头", () => {
    const h = new Headers({ host: "127.0.0.1:40001", "x-forwarded-host": "oa.example.com", "x-forwarded-proto": "https" });
    assert.equal(requestOrigin(h, "http://127.0.0.1:40001/api/mobile/version"), "https://oa.example.com");
    assert.equal(requestOrigin(new Headers({ host: "192.168.1.20:3000" }), "http://192.168.1.20:3000/"), "http://192.168.1.20:3000");
  });
});

describe("GET /api/mobile/version 与 APK 下载", () => {
  let tmp: string;
  const saved = process.env.MOBILE_RELEASE_DIR;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oa-mobile-api-"));
    process.env.MOBILE_RELEASE_DIR = tmp;
  });
  after(() => {
    if (saved === undefined) delete process.env.MOBILE_RELEASE_DIR;
    else process.env.MOBILE_RELEASE_DIR = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const req = (p: string, headers: Record<string, string> = {}, method = "GET") =>
    new NextRequest(`http://192.168.1.20:3000${p}`, { method, headers: { host: "192.168.1.20:3000", ...headers } });
  const ctx = (file: string) => ({ params: Promise.resolve({ file }) });

  it("未发布时返回 available=false，不缓存", async () => {
    const res = await versionGET(req("/api/mobile/version?current=100"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { available: false });
    assert.equal((await apkGET(req("/download/android/latest.apk"), ctx("latest.apk"))).status, 404);
  });

  it("按 current 给出 none / optional / required", async () => {
    writeRelease(tmp, goodRelease);
    const body = async (q: string) => (await (await versionGET(req(`/api/mobile/version${q}`))).json()) as Record<string, unknown>;
    const full = await body("");
    assert.equal(full.available, true);
    assert.equal(full.versionCode, 10203);
    assert.equal(full.versionName, "1.2.3");
    assert.equal(full.minVersionCode, 10100);
    assert.equal(full.notes, "修复若干问题");
    assert.equal(full.downloadUrl, "http://192.168.1.20:3000/download/android/oa-mobile-1.2.3.apk");
    assert.equal(full.sha256, SHA);
    assert.equal("update" in full, false);
    assert.equal((await body("?current=10000")).update, "required");
    assert.equal((await body("?current=10100")).update, "optional");
    assert.equal((await body("?current=10203")).update, "none");
    assert.equal("update" in (await body("?current=abc")), false);
  });

  it("APK：整包、Range 续传、HEAD、只提供登记的文件", async () => {
    writeRelease(tmp, goodRelease);
    const full = await apkGET(req("/download/android/oa-mobile-1.2.3.apk"), ctx("oa-mobile-1.2.3.apk"));
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "application/vnd.android.package-archive");
    assert.equal(full.headers.get("content-length"), String(APK.length));
    assert.match(full.headers.get("content-disposition") ?? "", /filename="oa-mobile-1\.2\.3\.apk"/);
    assert.ok(Buffer.from(await full.arrayBuffer()).equals(APK));

    const latest = await apkGET(req("/download/android/latest.apk"), ctx("latest.apk"));
    assert.equal(latest.status, 200);
    assert.ok(Buffer.from(await latest.arrayBuffer()).equals(APK));

    const part = await apkGET(req("/download/android/oa-mobile-1.2.3.apk", { range: "bytes=1000-" }), ctx("oa-mobile-1.2.3.apk"));
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), `bytes 1000-${APK.length - 1}/${APK.length}`);
    assert.ok(Buffer.from(await part.arrayBuffer()).equals(APK.subarray(1000)));

    const stale = await apkGET(req("/download/android/oa-mobile-1.2.3.apk", { range: "bytes=1000-", "if-range": '"other"' }), ctx("oa-mobile-1.2.3.apk"));
    assert.equal(stale.status, 200);
    await stale.arrayBuffer();

    const bad = await apkGET(req("/download/android/oa-mobile-1.2.3.apk", { range: "bytes=99999-" }), ctx("oa-mobile-1.2.3.apk"));
    assert.equal(bad.status, 416);

    const head = await apkHEAD(req("/download/android/oa-mobile-1.2.3.apk", {}, "HEAD"), ctx("oa-mobile-1.2.3.apk"));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(APK.length));

    for (const name of ["release.json", "..%2Frelease.json", "other.apk"]) {
      assert.equal((await apkGET(req(`/download/android/${name}`), ctx(name))).status, 404, name);
    }
  });

  it("未登录可访问检查更新接口与下载页，其他页面仍需登录", async () => {
    for (const p of ["/api/mobile/version", "/download/android", "/download/android/oa-mobile-1.2.3.apk"]) {
      const res = await proxy(req(p));
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get("location"), null, p);
    }
    assert.equal((await proxy(req("/api/mobile/other"))).status, 401);
    assert.match((await proxy(req("/download/ios"))).headers.get("location") ?? "", /\/login/);
  });
});
