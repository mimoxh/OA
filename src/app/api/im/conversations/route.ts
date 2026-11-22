import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { listConversations } from "@/lib/im/queries";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const conversations = await listConversations(user.id);
  return NextResponse.json({ conversations });
}
