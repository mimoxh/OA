// 必须作为测试文件的第一个 import：在 @/lib/db 初始化前指向隔离的测试库
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const file = "prisma/pms-test.db";

process.env.DATABASE_URL = `file:./${file}`;
delete process.env.REDIS_URL;

// server-only 只能在 React Server 环境中导入，测试进程里用空模块替代
const serverOnly = require.resolve("server-only");
require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;

for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(path.join(root, file + suffix), { force: true });
execSync("pnpm exec prisma db push", { cwd: root, env: process.env, stdio: "pipe" });
