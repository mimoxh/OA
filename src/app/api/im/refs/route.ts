import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { resolveRefs } from "@/lib/im/refs";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const refs = (body as { refs?: unknown })?.refs;
  if (!Array.isArray(refs)) return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  const clean = refs
    .filter((r): r is { type: string; id: string } => !!r && typeof r.type === "string" && typeof r.id === "string")
    .slice(0, 20) as { type: Parameters<typeof resolveRefs>[1][number]["type"]; id: string }[];
  const previews = await resolveRefs(user, clean);
  return NextResponse.json({ previews });
}
