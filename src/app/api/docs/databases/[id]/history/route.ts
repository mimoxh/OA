import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { listSchemaHistory } from "@/lib/docs/database/server";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]/history">) {
  const g = await guardDatabaseApi("docs:view");
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const beforeRaw = req.nextUrl.searchParams.get("before");
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const before = beforeRaw ? Number(beforeRaw) : undefined;
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const data = await listSchemaHistory(g.user, id, {
      before: before !== undefined && Number.isFinite(before) ? before : undefined,
      limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
    });
    return jsonNoStore(data);
  } catch (e) {
    return handleDatabaseError(e);
  }
}
