/**
 * 构建桌面一体包的内置服务端，输出到 desktop/src-tauri/resources/server：
 *   node.exe                 与构建机相同版本的 Node（better-sqlite3 原生模块按它的 ABI 编译）
 *   app/server.js …          Next standalone（目录联接已展开为真实文件，可随安装包移动）
 *   app/oa-server.mjs        网关 + 迁移 + 启动入口；oa-collab.mjs / oa-realtime.mjs 为协同与实时服务
 *   app/migrations/*.sql     数据库迁移
 * 由 desktop 的 build 脚本在 tauri build 之前调用。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { flattenPnpm } from "./flatten-pnpm.mjs";
import { generateMigration } from "./migration.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_DIR = ".next-desktop";
const OUT = path.join(ROOT, "desktop/src-tauri/resources/server");
const APP = path.join(OUT, "app");

function step(msg) {
  console.log(`\n[desktop] ${msg}`);
}

function run(command, env) {
  // Windows 上 pnpm 是 .cmd 脚本，需要经 shell 启动；整条命令以字符串传入
  const r = spawnSync(command, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env }, shell: true });
  if (r.status !== 0) throw new Error(`${command} 失败（退出码 ${r.status}）`);
}

function removeMaps(dir) {
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

step("检查数据库迁移");
generateMigration();

// --skip-next：复用上次的 Next 构建，只重新整理产物和编译服务端（调试打包流程用）
if (process.argv.includes("--skip-next") && fs.existsSync(path.join(ROOT, DIST_DIR, "standalone", "server.js"))) {
  step("跳过 Next 构建，复用 " + DIST_DIR);
} else {
  step("构建 Next standalone");
  // next build 会往 tsconfig.json 写入 .next-desktop 的类型路径，构建后还原，避免工作区出现无关改动
  const tsconfigPath = path.join(ROOT, "tsconfig.json");
  const tsconfig = fs.readFileSync(tsconfigPath);
  try {
    run("pnpm exec next build", { NEXT_DIST_DIR: DIST_DIR, NEXT_OUTPUT: "standalone", NEXT_TELEMETRY_DISABLED: "1" });
  } finally {
    fs.writeFileSync(tsconfigPath, tsconfig);
  }
}

step("整理 standalone 产物");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
const standalone = path.join(ROOT, DIST_DIR, "standalone");
// standalone 会把被追踪到的仓库文件（含 .env、源码）一并复制进来，这里只取运行所需部分
fs.copyFileSync(path.join(standalone, "server.js"), path.join(APP, "server.js"));
fs.copyFileSync(path.join(standalone, "package.json"), path.join(APP, "package.json"));
const distNodeModules = path.join(standalone, DIST_DIR, "node_modules");
fs.cpSync(path.join(standalone, DIST_DIR), path.join(APP, DIST_DIR), {
  recursive: true,
  filter: (src) => !src.startsWith(distNodeModules),
});
// 依赖：顶层包 + Turbopack 为外部模块生成的带哈希别名（.next-desktop/node_modules/<name>-<hash>）
const roots = [];
for (const [nmDir, src] of [
  [path.join(APP, "node_modules"), path.join(standalone, "node_modules")],
  [path.join(APP, DIST_DIR, "node_modules"), distNodeModules],
]) {
  if (!fs.existsSync(src)) continue;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const names = e.name.startsWith("@") ? fs.readdirSync(path.join(src, e.name)).map((s) => `${e.name}/${s}`) : [e.name];
    for (const folder of names) roots.push({ nmDir, folder, link: path.join(src, folder) });
  }
}
const packages = flattenPnpm({ root: APP, roots });
console.log(`[desktop] 已展开 ${packages} 个依赖包`);
fs.cpSync(path.join(ROOT, DIST_DIR, "static"), path.join(APP, DIST_DIR, "static"), { recursive: true });
fs.cpSync(path.join(ROOT, "public"), path.join(APP, "public"), { recursive: true });
fs.rmSync(path.join(APP, DIST_DIR, "cache"), { recursive: true, force: true });
removeMaps(path.join(APP, DIST_DIR));

// Next 实际加载的是 Prisma 适配器依赖的另一版 better-sqlite3，standalone 只追踪到顶层这一版的 package.json；
// 网关迁移与协同 / 实时服务要用它，这里补齐运行所需文件（仅当前平台的预编译模块）
const sqliteSrc = fs.realpathSync(path.join(ROOT, "node_modules/better-sqlite3"));
const sqliteDst = path.join(APP, "node_modules/better-sqlite3");
fs.rmSync(sqliteDst, { recursive: true, force: true });
fs.mkdirSync(path.join(sqliteDst, "prebuilds"), { recursive: true });
fs.cpSync(path.join(sqliteSrc, "lib"), path.join(sqliteDst, "lib"), { recursive: true });
fs.copyFileSync(path.join(sqliteSrc, "package.json"), path.join(sqliteDst, "package.json"));
const prebuild = `${process.platform}-${process.arch}.node`;
fs.copyFileSync(path.join(sqliteSrc, "prebuilds", prebuild), path.join(sqliteDst, "prebuilds", prebuild));

step("编译网关 / 协同 / 实时服务");
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: {
    "oa-server": "server/desktop/main.ts",
    "oa-collab": "server/collab.ts",
    "oa-realtime": "server/realtime.ts",
  },
  outdir: APP,
  outExtension: { ".js": ".mjs" },
  chunkNames: "oa-chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  tsconfig: "tsconfig.json",
  // 原生模块从 standalone 的 node_modules 加载
  external: ["better-sqlite3"],
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  banner: { js: 'import { createRequire as __oaCreateRequire } from "node:module"; const require = __oaCreateRequire(import.meta.url);' },
  plugins: [
    {
      // server-only 在非 React Server 环境下导入会直接抛错，这里替换为空模块
      name: "server-only-stub",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "oa-stub" }));
        build.onLoad({ filter: /.*/, namespace: "oa-stub" }, () => ({ contents: "", loader: "js" }));
      },
    },
  ],
});

step("复制迁移文件与 Node 运行时");
fs.cpSync(path.join(ROOT, "desktop/migrations"), path.join(APP, "migrations"), {
  recursive: true,
  filter: (src) => !src.endsWith(".prisma"),
});
fs.copyFileSync(process.execPath, path.join(OUT, "node.exe"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(OUT, "manifest.json"),
  JSON.stringify({ version: pkg.version, node: process.version, builtAt: new Date().toISOString() }, null, 2),
);

console.log(`\n[desktop] 完成：${path.relative(ROOT, OUT)}（${(dirSize(OUT) / 1024 / 1024).toFixed(1)} MB）`);
