import type { NextRequest } from "next/server";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import {
  bulkUpdateDatabaseRows,
  duplicateDatabaseRows,
  importRowsBatch,
  reorderDatabaseRows,
  trashDatabaseRows,
} from "@/lib/docs/database/server";
import type { PropertyValue } from "@/lib/docs/database/types";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/databases/[id]/rows/bulk">) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      action?: string;
      rowIds?: string[];
      patch?: Record<string, PropertyValue | null>;
      orderedRowIds?: string[];
      rows?: { title: string; properties: Record<string, PropertyValue | null> }[];
    };
    switch (body.action) {
      case "delete":
        return jsonNoStore(await trashDatabaseRows(g.user, id, Array.isArray(body.rowIds) ? body.rowIds : []));
      case "duplicate":
        return jsonNoStore(await duplicateDatabaseRows(g.user, id, Array.isArray(body.rowIds) ? body.rowIds : []));
      case "update":
        return jsonNoStore(
          await bulkUpdateDatabaseRows(
            g.user,
            id,
            Array.isArray(body.rowIds) ? body.rowIds : [],
            body.patch && typeof body.patch === "object" ? body.patch : {},
          ),
        );
      case "reorder":
        return jsonNoStore(
          await reorderDatabaseRows(g.user, id, Array.isArray(body.orderedRowIds) ? body.orderedRowIds : []),
        );
      case "import":
        return jsonNoStore(await importRowsBatch(g.user, id, Array.isArray(body.rows) ? body.rows : []));
      default:
        return jsonNoStore({ error: "不支持的批量操作类型" }, 400);
    }
  } catch (e) {
    return handleDatabaseError(e);
  }
}
