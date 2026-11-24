/**
 * 桌面一体包的数据库迁移生成：把 prisma/schema.prisma 与上次快照（desktop/migrations/schema.prisma）对比，
 * 有变化时生成下一个编号的 SQL 迁移文件并更新快照。迁移文件需要随代码提交，安装包据此升级用户已有的数据库。
 *   node scripts/desktop/migration.mjs          生成迁移（无变化则跳过）
 *   node scripts/desktop/migration.mjs --check  只检查，schema 有未生成的变化时以退出码 1 结束
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "desktop/migrations");
const SNAPSHOT = path.join(DIR, "schema.prisma");
const SCHEMA = path.join(ROOT, "prisma/schema.prisma");
const PRISMA_CLI = path.join(ROOT, "node_modules/prisma/build/index.js");

const normalize = (s) => s.replace(/\r\n/g, "\n");

export function migrationStatus() {
  const current = normalize(fs.readFileSync(SCHEMA, "utf8"));
  const snapshot = fs.existsSync(SNAPSHOT) ? normalize(fs.readFileSync(SNAPSHOT, "utf8")) : null;
  return { current, snapshot, upToDate: snapshot === current };
}

export function generateMigration() {
  const { current, snapshot, upToDate } = migrationStatus();
  if (upToDate) {
    console.log("[migration] schema 无变化");
    return null;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const from = snapshot === null ? ["--from-empty"] : ["--from-schema", SNAPSHOT];
  const r = spawnSync(process.execPath, [PRISMA_CLI, "migrate", "diff", ...from, "--to-schema", SCHEMA, "--script"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || "");
    throw new Error("prisma migrate diff 执行失败");
  }
  const sql = r.stdout.trim();
  const meaningful = sql
    .split("\n")
    .some((l) => l.trim() && !l.trim().startsWith("--"));
  let file = null;
  if (meaningful) {
    const existing = fs.readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f));
    const next = String(existing.length + 1).padStart(4, "0");
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    file = `${next}_${snapshot === null ? "init" : `schema_${stamp}`}.sql`;
    fs.writeFileSync(path.join(DIR, file), sql + "\n");
    console.log(`[migration] 已生成 desktop/migrations/${file}，请随代码一起提交`);
  } else {
    console.log("[migration] schema 有改动但不影响数据库结构，仅更新快照");
  }
  fs.writeFileSync(SNAPSHOT, current);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const { upToDate } = migrationStatus();
    if (!upToDate) {
      console.error("[migration] prisma/schema.prisma 有变化尚未生成桌面迁移，请运行 pnpm desktop:migration");
      process.exit(1);
    }
    console.log("[migration] 已是最新");
  } else {
    generateMigration();
  }
}
