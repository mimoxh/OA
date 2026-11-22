import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { createDatabaseRow } from "@/lib/docs/database/server";
import type { PropertyValue } from "@/lib/docs/database/types";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]/rows">) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      icon?: string | null;
      properties?: Record<string, PropertyValue | null>;
    };
    const row = await createDatabaseRow(g.user, id, {
      title: typeof body.title === "string" ? body.title : undefined,
      icon: body.icon === undefined ? undefined : body.icon,
      properties: body.properties && typeof body.properties === "object" ? body.properties : undefined,
    });
    return jsonNoStore({ row }, 201);
  } catch (e) {
    return handleDatabaseError(e);
  }
}
