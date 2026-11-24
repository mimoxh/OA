"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { NAV_MODULES, parseRailPins } from "@/lib/nav";
import { parseInput } from "@/lib/oa/validate";

const appKeySchema = z.custom<string>((v) => typeof v === "string" && NAV_MODULES.some((m) => m.key === v), "应用不存在");

/** 把应用固定到 / 移出左侧导航栏 */
export async function setRailPin(key: string, pinned: boolean) {
  return runAction(null, async (user) => {
    const k = parseInput(appKeySchema, key);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { railPins: true } });
    const pins = parseRailPins(u.railPins).filter((p) => p !== k);
    if (pinned) pins.push(k);
    await db.user.update({ where: { id: user.id }, data: { railPins: JSON.stringify(pins) } });
    revalidatePath("/", "layout");
  });
}
