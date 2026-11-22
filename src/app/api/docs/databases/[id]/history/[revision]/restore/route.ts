import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { restoreSchemaVersion } from "@/lib/docs/database/server";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/docs/databases/[id]/history/[revision]/restore">,
) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id, revision } = await ctx.params;
    const rev = Number(revision);
    if (!Number.isInteger(rev) || rev < 1) return jsonNoStore({ error: "修订号无效" }, 400);
    const body = (await req.json().catch(() => ({}))) as { expectedRevision?: number };
    const result = await restoreSchemaVersion(
      g.user,
      id,
      rev,
      typeof body.expectedRevision === "number" ? body.expectedRevision : undefined,
    );
    return jsonNoStore(result);
  } catch (e) {
    return handleDatabaseError(e);
  }
}
