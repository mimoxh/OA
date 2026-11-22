import "dotenv/config";
import { db } from "@/lib/db";
import { parseContent } from "@/lib/docs/content";
import { syncDocumentLinks } from "@/lib/docs/links";
import { parseWhiteboard, whiteboardLinkContent } from "@/lib/docs/whiteboard/content";

/**
 * 幂等回填脚本：扫描所有非模板文档正文中的 /docs/<id> 链接并同步到 DocumentLink。
 * 用法：pnpm exec tsx scripts/backfill-doc-links.ts
 */
async function main() {
  const docs = await db.document.findMany({
    select: { id: true, content: true, isTemplate: true, kind: true },
    orderBy: { createdAt: "asc" },
  });

  let processed = 0;
  let totalLinks = 0;
  for (const d of docs) {
    const board = d.kind === "whiteboard" ? parseWhiteboard(d.content) : null;
    const content = board ? whiteboardLinkContent(board.elements) : parseContent(d.content);
    const count = await syncDocumentLinks(db, d.id, content, { isTemplate: d.isTemplate });
    processed += 1;
    totalLinks += count;
  }
  console.log(`[backfill-doc-links] 完成：扫描 ${processed} 篇文档，同步 ${totalLinks} 条双链索引。`);
}

main()
  .catch((err) => {
    console.error("[backfill-doc-links] 执行失败：", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
