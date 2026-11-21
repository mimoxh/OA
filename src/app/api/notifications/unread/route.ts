import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 });
  const count = await db.notification.count({ where: { userId: user.id, read: false } });
  return NextResponse.json({ count });
}
