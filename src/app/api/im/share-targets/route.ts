import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { listConversations } from "@/lib/im/queries";

/** 分享弹窗的目标列表：现有非机器人会话 + 在职同事（便于直接发起单聊分享） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const [convs, users] = await Promise.all([
    listConversations(user.id),
    db.user.findMany({
      where: { active: true, id: { not: user.id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, avatarColor: true, title: true, department: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    conversations: convs.filter((c) => c.type !== "BOT"),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      avatarColor: u.avatarColor,
      title: u.title,
      department: u.department?.name ?? null,
    })),
  });
}
