import type { DbClient } from "@/lib/db";

export const PERSONAL_SPACE_NAME = "我的文档空间";
export const PERSONAL_SPACE_ICON = "🏠";

function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** 为用户创建个人空间（已有则跳过）。新建用户时在同一事务内调用 */
export async function createPersonalSpace(client: DbClient, userId: string) {
  const existing = await client.space.findUnique({ where: { ownerId: userId }, select: { id: true } });
  if (existing) return existing.id;
  try {
    const space = await client.space.create({
      data: {
        name: PERSONAL_SPACE_NAME,
        icon: PERSONAL_SPACE_ICON,
        description: "只有你自己能看到的私人空间",
        visibility: "PRIVATE",
        createdById: userId,
        ownerId: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: { id: true },
    });
    return space.id;
  } catch (e) {
    // 并发请求同时补建时，唯一约束保证只会成功一个
    if (!isUniqueViolation(e)) throw e;
    const space = await client.space.findUniqueOrThrow({ where: { ownerId: userId }, select: { id: true } });
    return space.id;
  }
}

const ensured = new Map<string, Promise<unknown>>();

/** 进入文档模块时为老用户补建个人空间；同一进程内每个用户只检查一次 */
export function ensurePersonalSpace(client: DbClient, userId: string) {
  let p = ensured.get(userId);
  if (!p) {
    p = createPersonalSpace(client, userId).catch((e) => {
      ensured.delete(userId);
      throw e;
    });
    ensured.set(userId, p);
  }
  return p;
}
