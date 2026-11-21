import Link from "next/link";
import { db } from "@/lib/db";

/** 侧边栏文档区（占位实现，由文档模块替换为完整页面树） */
export async function DocsSidebar({ userId }: { userId: string }) {
  const spaces = await db.space.findMany({
    where: { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId } } }] },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, icon: true },
  });
  return (
    <div>
      <div className="mb-1 px-2 text-xs font-medium text-ink-3">文档</div>
      {spaces.map((s) => (
        <Link key={s.id} href={`/docs?space=${s.id}`} className="flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-2 hover:bg-active/70">
          <span>{s.icon}</span>
          <span className="truncate">{s.name}</span>
        </Link>
      ))}
    </div>
  );
}
