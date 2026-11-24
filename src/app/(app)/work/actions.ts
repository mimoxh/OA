"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { can } from "@/lib/auth/dal";
import { isRailOrderId, isRailPinKey, parseRailPins, RAIL_ORDER_MAX, railPinProjectId } from "@/lib/nav";
import { parseInput } from "@/lib/oa/validate";

const pinKeySchema = z.custom<string>((v) => isRailPinKey(v), "要固定的入口不存在");
const orderSchema = z.array(z.custom<string>((v) => isRailOrderId(v), "排序数据不正确")).max(RAIL_ORDER_MAX, "排序数据不正确");

/** 把应用或项目固定到 / 移出左侧导航栏 */
export async function setRailPin(key: string, pinned: boolean) {
  return runAction(null, async (user) => {
    const k = parseInput(pinKeySchema, key);
    const projectId = railPinProjectId(k);
    if (projectId && pinned) {
      if (!can(user, "pms:view")) throw new Error("没有项目管理的访问权限");
      const exists = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!exists) throw new Error("项目不存在");
    }
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { railPins: true } });
    const pins = parseRailPins(u.railPins).filter((p) => p !== k);
    if (pinned) pins.push(k);
    await db.user.update({ where: { id: user.id }, data: { railPins: JSON.stringify(pins) } });
    revalidatePath("/", "layout");
  });
}

/** 保存左侧导航栏图标的拖拽排序（客户端已即时生效，因此不刷新页面） */
export async function setRailOrder(ids: string[]) {
  return runAction(null, async (user) => {
    const order = [...new Set(parseInput(orderSchema, ids))];
    await db.user.update({ where: { id: user.id }, data: { railOrder: JSON.stringify(order) } });
  });
}
