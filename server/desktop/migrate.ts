import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const INTERNAL_TABLES = new Set(["_oa_migrations", "_prisma_migrations"]);

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 提取数据库所有业务表的「表名 → 排序后列名」指纹，用于精确比对未登记 _oa_migrations 的已有库 */
function schemaSignature(db: Database.Database): string {
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .pluck()
      .all() as string[]
  ).filter((t) => !INTERNAL_TABLES.has(t));
  const entries = tables.map((table) => {
    const cols = (db.pragma(`table_info(${quoteIdent(table)})`) as { name: string }[])
      .map((c) => c.name)
      .sort();
    return `${table}:${cols.join(",")}`;
  });
  return entries.join("\n");
}

function userTableCount(db: Database.Database): number {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .pluck()
    .all() as string[];
  return tables.filter((t) => !INTERNAL_TABLES.has(t)).length;
}

/** 在内存库按顺序重放迁移，找出与当前库表结构完全吻合的最新基线序号；不匹配返回 -1 */
function detectBaselineIndex(db: Database.Database, dir: string, files: string[]): number {
  const target = schemaSignature(db);
  const mem = new Database(":memory:");
  try {
    mem.pragma("foreign_keys = OFF");
    let matched = -1;
    for (let i = 0; i < files.length; i++) {
      mem.exec(fs.readFileSync(path.join(dir, files[i]), "utf8"));
      if (schemaSignature(mem) === target) matched = i;
    }
    return matched;
  } finally {
    mem.close();
  }
}

/**
 * 按文件名顺序执行 desktop/migrations/*.sql（由 scripts/desktop/migration.mjs 根据 schema 变化生成），
 * 已执行的记录在 _oa_migrations。升级已有数据库前先用 VACUUM INTO 备份一份。
 * 若检测到由命令行 `prisma db push` 创建的已有库（无 _oa_migrations 记录但业务表已存在），
 * 会比对结构基线自动补登已涵盖的迁移，并仅执行后续新增迁移。
 * 返回本次实际执行的迁移文件名。
 */
export function migrate(dbFile: string, dir: string, backupDir: string): string[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  if (!files.length) throw new Error(`${dir} 中没有迁移文件`);

  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile, { timeout: 5000 });
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS _oa_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set(db.prepare("SELECT name FROM _oa_migrations").pluck().all() as string[]);

    if (applied.size === 0 && userTableCount(db) > 0) {
      const baseline = detectBaselineIndex(db, dir, files);
      if (baseline < 0) {
        throw new Error("检测到已有数据库表，但结构与当前迁移历史不匹配；已中止自动迁移以保护数据，请确认数据库来源并先做好备份");
      }
      const now = new Date().toISOString();
      const record = db.prepare("INSERT INTO _oa_migrations (name, applied_at) VALUES (?, ?)");
      db.exec("BEGIN");
      try {
        for (let i = 0; i <= baseline; i++) {
          record.run(files[i], now);
          applied.add(files[i]);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }

    const pending = files.filter((f) => !applied.has(f));
    if (!pending.length) return [];

    if (applied.size > 0) {
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const target = path.join(backupDir, `oa-${stamp}-before-${pending[0].replace(/\.sql$/, "")}.db`);
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    }

    // PRAGMA foreign_keys 在事务内无效：事务开始前关闭，重建表之后再检查外键约束
    db.pragma("foreign_keys = OFF");
    const record = db.prepare("INSERT INTO _oa_migrations (name, applied_at) VALUES (?, ?)");
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      db.exec("BEGIN");
      try {
        db.exec(sql);
        const violations = db.pragma("foreign_key_check") as unknown[];
        if (violations.length) throw new Error(`外键检查未通过（${violations.length} 行）`);
        record.run(file, new Date().toISOString());
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw new Error(`数据库迁移 ${file} 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    db.pragma("foreign_keys = ON");
    return pending;
  } finally {
    db.close();
  }
}
