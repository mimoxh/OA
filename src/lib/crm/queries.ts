import "server-only";
import { db } from "@/lib/db";
import type { UserOption } from "@/lib/crm/types";

export type { UserOption };

export function getActiveUsers(): Promise<UserOption[]> {
  return db.user.findMany({
    where: { active: true },
    select: { id: true, name: true, avatarColor: true },
    orderBy: { createdAt: "asc" },
  });
}

export function getCustomerOptions() {
  return db.customer.findMany({ select: { id: true, name: true, code: true }, orderBy: { code: "asc" } });
}
