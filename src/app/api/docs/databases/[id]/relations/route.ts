import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { createRelationPair } from "@/lib/docs/database/server";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]/relations">) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      targetDatabaseId?: string;
      name?: string;
      pairedName?: string;
    };
    if (!body.targetDatabaseId || !body.name) {
      return jsonNoStore({ error: "请提供目标表格和关联字段名称" }, 400);
    }
    const created = await createRelationPair(g.user, id, {
      targetDatabaseId: body.targetDatabaseId,
      name: body.name,
      pairedName: body.pairedName,
    });
    return jsonNoStore(created, 201);
  } catch (e) {
    return handleDatabaseError(e);
  }
}
