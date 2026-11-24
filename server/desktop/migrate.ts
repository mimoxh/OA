import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * 按文件名顺序执行 desktop/migrations/*.sql（由 scripts/desktop/migration.mjs 根据 schema 变化生成），
 * 已执行的记录在 _oa_migrations。升级已有数据库前先用 VACUUM INTO 备份一份。
 * 返回本次执行的迁移文件名。
 */
export function migrate(dbFile: string, dir: string, backupDir: string): string[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  if (!files.length) throw new Error(`${dir} 中没有迁移文件`);

  const db = new Database(dbFile);
  try {
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS _oa_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set(db.prepare("SELECT name FROM _oa_migrations").pluck().all() as string[]);
    const pending = files.filter((f) => !applied.has(f));
    if (!pending.length) return [];

    if (applied.size > 0) {
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
