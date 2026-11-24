// 必须作为测试文件的第一个 import：在 @/lib/db 初始化前指向隔离的测试库
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const file = "prisma/webhook-test.db";

process.env.DATABASE_URL = `file:./${file}`;
process.env.AUTH_SECRET = "test-secret-for-webhook-flow-tests-0123456789";
delete process.env.REDIS_URL;

for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(path.join(root, file + suffix), { force: true });
execSync("pnpm exec prisma db push", { cwd: root, env: process.env, stdio: "pipe" });
