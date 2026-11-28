import fs from "node:fs/promises";
import path from "node:path";

// 同步脚本本身不含任何密钥，未登录也可下载，方便在运行 Orca 的电脑上一条命令完成同步。
// 容器 / 桌面一体包由 bundle-server 复制到 standalone 工作目录下的同一位置，因此不需要 Next 文件追踪
const SCRIPT_FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "orca", "sync-catalog.mjs");

export async function GET() {
  let body: string;
  try {
    body = await fs.readFile(/*turbopackIgnore: true*/ SCRIPT_FILE, "utf8");
  } catch {
    return Response.json({ error: "服务器上缺少同步脚本 scripts/orca/sync-catalog.mjs" }, { status: 404 });
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": 'attachment; filename="oa-orca-sync.mjs"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
