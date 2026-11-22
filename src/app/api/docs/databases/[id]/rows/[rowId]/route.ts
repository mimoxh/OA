import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { trashDatabaseRows, updateDatabaseRow } from "@/lib/docs/database/server";
import type { PropertyValue } from "@/lib/docs/database/types";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]/rows/[rowId]">) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id, rowId } = await ctx.params;
    const body = (await req.json()) as {
      title?: string;
      icon?: string | null;
      cover?: string | null;
      properties?: Record<string, PropertyValue | null>;
    };
    const row = await updateDatabaseRow(g.user, id, rowId, {
      title: typeof body.title === "string" ? body.title : undefined,
      icon: body.icon === undefined ? undefined : body.icon,
      cover: body.cover === undefined ? undefined : body.cover,
      properties: body.properties && typeof body.properties === "object" ? body.properties : undefined,
    });
    return jsonNoStore({ row });
  } catch (e) {
    return handleDatabaseError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]/rows/[rowId]">) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id, rowId } = await ctx.params;
    const res = await trashDatabaseRows(g.user, id, [rowId]);
    return jsonNoStore(res);
  } catch (e) {
    return handleDatabaseError(e);
  }
}
