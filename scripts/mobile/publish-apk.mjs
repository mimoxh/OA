/**
 * 发布 Android 安装包到下载目录（NAS 的 /data/mobile 挂载目录、桌面一体包数据目录下的 mobile/ 等）：
 *   node scripts/mobile/publish-apk.mjs --dir <发布目录> [--notes "更新说明" | --notes-file <文件>] [--min <版本>] [--apk <文件>] [--force]
 *
 * - 读取 gradle 生成的 output-metadata.json 得到 versionCode / versionName；
 * - 用 apksigner 校验签名（必须 v2/v3、不能是调试证书），记录证书 SHA-256；
 * - 复制为 oa-mobile-<versionName>.apk，写 release.json（/api/mobile/version 与 /download/android 读取它）；
 * - 只保留本次和上一个版本的 APK；混淆映射 mapping.txt 归档到 %USERPROFILE%/.oa-mobile/mappings/（不放进发布目录）。
 * --min：最低支持版本（低于它的 App 会被强制更新）。可写 X.Y.Z、versionCode 或 latest（= 本次版本）；不写时沿用上次的设置。
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APK_DIR = path.join(ROOT, "mobile/android/app/build/outputs/apk/release");
const MAPPING = path.join(ROOT, "mobile/android/app/build/outputs/mapping/release/mapping.txt");
const VERSION_RE = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})$/;

function fail(msg) {
  console.error(`[mobile-publish] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--force") out.force = true;
    else if (["--dir", "--apk", "--min", "--notes", "--notes-file"].includes(a)) {
      if (argv[i + 1] === undefined) fail(`${a} 缺少参数`);
      out[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else fail(`未知参数：${a}`);
  }
  return out;
}

function versionCodeOf(name) {
  const m = VERSION_RE.exec(name);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

function findApksigner() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
  const bt = path.join(sdk, "build-tools");
  if (!fs.existsSync(bt)) return null;
  const versions = fs
    .readdirSync(bt)
    .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    for (const name of ["apksigner.bat", "apksigner"]) {
      const p = path.join(bt, v, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function verifySignature(apk) {
  const signer = findApksigner();
  if (!signer) fail("找不到 apksigner（Android SDK build-tools），请设置 ANDROID_HOME");
  const r = spawnSync(`"${signer}" verify --verbose --print-certs "${apk}"`, { shell: true, encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) fail(`apksigner 校验失败：\n${out}`);
  const v2 = /Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(out);
  const v3 = /Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(out);
  if (!v2 && !v3) fail("安装包没有 v2/v3 签名");
  const dn = /Signer #1 certificate DN: (.+)/.exec(out)?.[1]?.trim() ?? "";
  if (/CN=Android Debug/.test(dn)) fail("这是调试证书签名的包，不能发布（请用 pnpm mobile:build 构建 release 包）");
  const hex = /Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/i.exec(out)?.[1];
  if (!hex) fail("无法读取签名证书指纹");
  return { v2, v3, dn, certSha256: hex.toUpperCase().match(/../g).join(":") };
}

const args = parseArgs(process.argv.slice(2));
const dir = path.resolve(ROOT, args.dir ?? process.env.MOBILE_RELEASE_DIR ?? "data/mobile");
const apk = path.resolve(ROOT, args.apk ?? path.join(APK_DIR, "app-release.apk"));
if (!fs.existsSync(apk)) fail(`找不到安装包 ${apk}，先运行 pnpm mobile:build`);

const metaFile = path.join(path.dirname(apk), "output-metadata.json");
if (!fs.existsSync(metaFile)) fail(`找不到 ${metaFile}（--apk 必须指向 gradle 的输出目录）`);
const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
const el = meta.elements?.find((e) => e.outputFile === path.basename(apk));
if (!el) fail(`output-metadata.json 里没有 ${path.basename(apk)}`);
const versionCode = Number(el.versionCode);
const versionName = String(el.versionName);
if (versionCodeOf(versionName) !== versionCode) fail(`versionCode ${versionCode} 与 versionName ${versionName} 不符合统一规则`);

const sig = verifySignature(apk);
const data = fs.readFileSync(apk);
const sha256 = crypto.createHash("sha256").update(data).digest("hex");

fs.mkdirSync(dir, { recursive: true });
const releaseFile = path.join(dir, "release.json");
let previous = null;
try {
  previous = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
} catch {}
if (previous && previous.versionCode >= versionCode && !args.force) {
  fail(`发布目录里已有 ${previous.versionName}（${previous.versionCode}），新版本 ${versionName}（${versionCode}）没有更高。确需回退请加 --force`);
}
if (previous?.certSha256 && previous.certSha256 !== sig.certSha256 && !args.force) {
  fail(`签名证书与上次发布不同（${previous.certSha256} → ${sig.certSha256}），已安装的 App 将无法覆盖升级。确认无误请加 --force`);
}

let minVersionCode = previous?.minVersionCode ?? 0;
if (args.min !== undefined) {
  if (args.min === "latest") minVersionCode = versionCode;
  else if (/^\d+$/.test(args.min)) minVersionCode = Number(args.min);
  else if (versionCodeOf(args.min) != null) minVersionCode = versionCodeOf(args.min);
  else fail(`--min 无效：${args.min}`);
}
if (minVersionCode > versionCode) fail(`最低支持版本 ${minVersionCode} 不能高于本次版本 ${versionCode}`);

let notes = args.notes ?? "";
if (args.notesFile) notes = fs.readFileSync(path.resolve(ROOT, args.notesFile), "utf8").trim();

const file = `oa-mobile-${versionName}.apk`;
const tmpApk = path.join(dir, `.${file}.tmp`);
fs.writeFileSync(tmpApk, data);
fs.renameSync(tmpApk, path.join(dir, file));

const release = {
  versionCode,
  versionName,
  minVersionCode,
  file,
  size: data.length,
  sha256,
  notes,
  publishedAt: new Date().toISOString(),
  certSha256: sig.certSha256,
};
const tmpJson = path.join(dir, ".release.json.tmp");
fs.writeFileSync(tmpJson, JSON.stringify(release, null, 2) + "\n");
fs.renameSync(tmpJson, releaseFile);

// 只保留本次与上一个版本的安装包
const keep = new Set([file, previous?.file].filter(Boolean));
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith(".apk") && !keep.has(f)) fs.rmSync(path.join(dir, f));
}

// 映射文件必须与安装包同一次构建：--apk 指向其他目录时只认同目录下的 mapping.txt
const mapping = path.dirname(apk) === APK_DIR ? MAPPING : path.join(path.dirname(apk), "mapping.txt");
let mappingNote = "无（未开启混淆或未找到 mapping.txt）";
if (fs.existsSync(mapping)) {
  const mapDir = path.join(os.homedir(), ".oa-mobile", "mappings");
  fs.mkdirSync(mapDir, { recursive: true });
  const dst = path.join(mapDir, `mapping-${versionName}-${versionCode}.txt`);
  fs.copyFileSync(mapping, dst);
  mappingNote = dst;
}

console.log(`[mobile-publish] 已发布 ${versionName}（versionCode ${versionCode}）`);
console.log(`  目录：${dir}`);
console.log(`  安装包：${file}（${(data.length / 1024 / 1024).toFixed(2)} MB，SHA-256 ${sha256}）`);
console.log(`  签名：v2=${sig.v2} v3=${sig.v3}，证书 SHA-256 ${sig.certSha256}`);
console.log(`  最低支持版本：${minVersionCode || "不限"}`);
console.log(`  混淆映射：${mappingNote}`);
