import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { getSchemaHistoryDetail } from "@/lib/docs/database/server";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/docs/databases/[id]/history/[revision]">,
) {
  const g = await guardDatabaseApi("docs:view");
  if (!g.ok) return g.response;
  try {
    const { id, revision } = await ctx.params;
    const rev = Number(revision);
    if (!Number.isInteger(rev) || rev < 1) return jsonNoStore({ error: "修订号无效" }, 400);
    const detail = await getSchemaHistoryDetail(g.user, id, rev);
    return jsonNoStore(detail);
  } catch (e) {
    return handleDatabaseError(e);
  }
}
