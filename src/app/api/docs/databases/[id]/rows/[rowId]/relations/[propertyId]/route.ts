import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { changeRowRelations } from "@/lib/docs/database/server";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/docs/databases/[id]/rows/[rowId]/relations/[propertyId]">,
) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id, rowId, propertyId } = await ctx.params;
    const body = (await req.json()) as { add?: string[]; remove?: string[] };
    const row = await changeRowRelations(g.user, id, rowId, propertyId, {
      add: Array.isArray(body.add) ? body.add : [],
      remove: Array.isArray(body.remove) ? body.remove : [],
    });
    return jsonNoStore({ row });
  } catch (e) {
    return handleDatabaseError(e);
  }
}
