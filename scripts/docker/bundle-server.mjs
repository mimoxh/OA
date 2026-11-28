/**
 * 构建容器 / NAS 单端口独立服务端产物（默认输出到 .standalone-out，可通过 --out 指定）：
 *   server.js / .next-docker / public  Next standalone 运行产物（含 public/agent-icons/*.png）
 *   node_modules                       经 flattenPnpm 展开的扁平依赖（无跨阶段悬空符号链接）
 *   oa-standalone.mjs                  单端口网关 + 自动 WAL/迁移 + 启动入口
 *   oa-collab.mjs / oa-realtime.mjs    Hocuspocus 协同与 WebSocket 实时服务
 *   migrations/*.sql                   SQLite 迁移脚本
 *   scripts/orca/sync-catalog.mjs      Orca 目录同步脚本（供设置页一键下载）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { flattenPnpm } from "../desktop/flatten-pnpm.mjs";
import { copyPdfjsAssets } from "../desktop/pdfjs-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_DIR = ".next-docker";

function parseArgs(argv) {
  let out = path.join(ROOT, ".standalone-out");
  let skipNext = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skip-next") {
      skipNext = true;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      out = path.resolve(ROOT, argv[++i]);
    }
  }
  return { out, skipNext };
}

function step(msg) {
  console.log(`\n[docker-bundle] ${msg}`);
}

function run(command, env) {
  const r = spawnSync(command, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env }, shell: true });
  if (r.status !== 0) throw new Error(`${command} 失败（退出码 ${r.status}）`);
}

function removeMaps(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) removeMaps(p);
    else if (entry.name.endsWith(".map")) fs.rmSync(p);
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function isLinuxMusl() {
  if (process.platform !== "linux") return false;
  try {
    const maps = fs.readFileSync("/proc/self/maps", "latin1");
    if (/\/ld-musl-[^/\s]*\.so/.test(maps)) return true;
    if (/\/(?:ld-linux[^/\s]*|libc)\.so\.\d/.test(maps)) return false;
  } catch {}
  return false;
}

function copyBetterSqliteRuntime(outDir) {
  const sqliteSrc = fs.realpathSync(path.join(ROOT, "node_modules/better-sqlite3"));
  const sqliteDst = path.join(outDir, "node_modules/better-sqlite3");
  fs.rmSync(sqliteDst, { recursive: true, force: true });
  fs.mkdirSync(sqliteDst, { recursive: true });
  fs.cpSync(path.join(sqliteSrc, "lib"), path.join(sqliteDst, "lib"), { recursive: true });
  fs.copyFileSync(path.join(sqliteSrc, "package.json"), path.join(sqliteDst, "package.json"));

  let copiedBinary = false;
  const compiled = path.join(sqliteSrc, "build/Release/better_sqlite3.node");
  if (fs.existsSync(compiled)) {
    fs.mkdirSync(path.join(sqliteDst, "build/Release"), { recursive: true });
    fs.copyFileSync(compiled, path.join(sqliteDst, "build/Release/better_sqlite3.node"));
    copiedBinary = true;
  }

  const target = `${isLinuxMusl() ? "linuxmusl" : process.platform}-${process.arch}.node`;
  const prebuild = path.join(sqliteSrc, "prebuilds", target);
  if (fs.existsSync(prebuild)) {
    fs.mkdirSync(path.join(sqliteDst, "prebuilds"), { recursive: true });
    fs.copyFileSync(prebuild, path.join(sqliteDst, "prebuilds", target));
    copiedBinary = true;
  }

  if (!copiedBinary) {
    throw new Error(`未找到适用于当前平台（${process.platform}/${process.arch}）的 better-sqlite3 原生模块`);
  }
}

const { out: OUT, skipNext } = parseArgs(process.argv.slice(2));

const migrationsSrc = path.join(ROOT, "desktop/migrations");
const migrationFiles = fs.existsSync(migrationsSrc)
  ? fs.readdirSync(migrationsSrc).filter((f) => /^\d{4}_.+\.sql$/.test(f))
  : [];
if (!migrationFiles.length) {
  throw new Error("desktop/migrations 中缺少 SQL 迁移文件");
}

if (skipNext && fs.existsSync(path.join(ROOT, DIST_DIR, "standalone", "server.js"))) {
  step("跳过 Next 构建，复用 " + DIST_DIR);
} else {
  step("构建 Next standalone");
  const tsconfigPath = path.join(ROOT, "tsconfig.json");
  const tsconfig = fs.readFileSync(tsconfigPath);
  try {
    run("pnpm exec next build", {
      NEXT_DIST_DIR: DIST_DIR,
      NEXT_OUTPUT: "standalone",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: process.env.DATABASE_URL || "file:./prisma/build.db",
    });
  } finally {
    fs.writeFileSync(tsconfigPath, tsconfig);
  }
}

step("整理 standalone 产物到 " + path.relative(ROOT, OUT));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const standalone = path.join(ROOT, DIST_DIR, "standalone");
fs.copyFileSync(path.join(standalone, "server.js"), path.join(OUT, "server.js"));
fs.copyFileSync(path.join(standalone, "package.json"), path.join(OUT, "package.json"));

const distNodeModules = path.join(standalone, DIST_DIR, "node_modules");
fs.cpSync(path.join(standalone, DIST_DIR), path.join(OUT, DIST_DIR), {
  recursive: true,
  filter: (src) => !src.startsWith(distNodeModules),
});

const roots = [];
for (const [nmDir, src] of [
  [path.join(OUT, "node_modules"), path.join(standalone, "node_modules")],
  [path.join(OUT, DIST_DIR, "node_modules"), distNodeModules],
]) {
  if (!fs.existsSync(src)) continue;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const names = e.name.startsWith("@") ? fs.readdirSync(path.join(src, e.name)).map((s) => `${e.name}/${s}`) : [e.name];
    for (const folder of names) roots.push({ nmDir, folder, link: path.join(src, folder) });
  }
}
const packages = flattenPnpm({ root: OUT, roots });
console.log(`[docker-bundle] 已展开 ${packages} 个依赖包`);

fs.cpSync(path.join(ROOT, DIST_DIR, "static"), path.join(OUT, DIST_DIR, "static"), { recursive: true });
fs.cpSync(path.join(ROOT, "public"), path.join(OUT, "public"), { recursive: true });
fs.rmSync(path.join(OUT, DIST_DIR, "cache"), { recursive: true, force: true });
removeMaps(path.join(OUT, DIST_DIR));

// 补齐顶层 better-sqlite3 运行时（供迁移引擎与 orca-catalog 只读探测加载）
copyBetterSqliteRuntime(OUT);
copyPdfjsAssets(ROOT, OUT);

step("编译单端口网关 / 协同 / 实时服务");
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: {
    "oa-standalone": "server/standalone/main.ts",
    "oa-collab": "server/collab.ts",
    "oa-realtime": "server/realtime.ts",
  },
  outdir: OUT,
  outExtension: { ".js": ".mjs" },
  chunkNames: "oa-chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  tsconfig: "tsconfig.json",
  external: ["better-sqlite3"],
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  banner: { js: 'import { createRequire as __oaCreateRequire } from "node:module"; const require = __oaCreateRequire(import.meta.url);' },
  plugins: [
    {
      name: "server-only-stub",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "oa-stub" }));
        build.onLoad({ filter: /.*/, namespace: "oa-stub" }, () => ({ contents: "", loader: "js" }));
      },
    },
  ],
});

step("复制 SQLite 迁移文件");
fs.cpSync(migrationsSrc, path.join(OUT, "migrations"), {
  recursive: true,
  filter: (src) => !src.endsWith(".prisma"),
});

// /api/im/webhooks/orca-catalog/sync-script 从工作目录（standalone server.js 所在目录）提供下载
step("复制 Orca 目录同步脚本");
fs.mkdirSync(path.join(OUT, "scripts/orca"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "scripts/orca/sync-catalog.mjs"), path.join(OUT, "scripts/orca/sync-catalog.mjs"));

console.log(`\n[docker-bundle] 完成：${path.relative(ROOT, OUT) || OUT}（${(dirSize(OUT) / 1024 / 1024).toFixed(1)} MB）`);
