import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardDatabaseApi, handleDatabaseError, jsonNoStore } from "@/lib/docs/database/http";
import { createDatabaseRecord, listAccessibleDatabases } from "@/lib/docs/database/server";

const createBody = z.object({
  spaceId: z.string().min(1),
  parentId: z.string().nullish(),
  title: z.string().max(200).optional(),
  icon: z.string().max(16).nullish(),
});

export async function GET(req: NextRequest) {
  const g = await guardDatabaseApi("docs:view");
  if (!g.ok) return g.response;
  try {
    const spaceId = req.nextUrl.searchParams.get("spaceId")?.trim() || null;
    const databases = await listAccessibleDatabases(g.user, spaceId);
    return jsonNoStore({ databases });
  } catch (e) {
    return handleDatabaseError(e);
  }
}

export async function POST(req: NextRequest) {
  const g = await guardDatabaseApi("docs:edit");
  if (!g.ok) return g.response;
  try {
    const body = createBody.parse(await req.json());
    const created = await createDatabaseRecord(g.user, body);
    return jsonNoStore(created, 201);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return jsonNoStore({ error: "请求参数无效" }, 400);
    }
    return handleDatabaseError(e);
  }
}
