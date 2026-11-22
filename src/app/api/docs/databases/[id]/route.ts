import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { getDatabasePayload, saveDatabaseSchema } from "@/lib/docs/database/server";
import type { DatabaseView, PropertyDefinition } from "@/lib/docs/database/types";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]">) {
  const g = await guardDatabaseApi("docs:view");
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const includeRows = req.nextUrl.searchParams.get("rows") !== "none";
    const data = await getDatabasePayload(g.user, id, { includeRows });
    return jsonNoStore(data);
  } catch (e) {
    return handleDatabaseError(e);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]">) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      properties?: PropertyDefinition[];
      views?: DatabaseView[];
      expectedRevision?: number;
    };
    if (!Array.isArray(body.properties) || !Array.isArray(body.views)) {
      return jsonNoStore({ error: "缺少字段或视图定义" }, 400);
    }
    const saved = await saveDatabaseSchema(g.user, id, {
      properties: body.properties,
      views: body.views,
      expectedRevision: typeof body.expectedRevision === "number" ? body.expectedRevision : undefined,
    });
    return jsonNoStore(saved);
  } catch (e) {
    return handleDatabaseError(e);
  }
}
