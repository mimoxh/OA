import type { DbClient } from "@/lib/db";

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** 带日期的单据号，如 PO202611190001 */
export async function nextNo(tx: DbClient, prefix: string) {
  const date = today();
  const key = `${prefix}-${date}`;
  const seq = await tx.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}${date}${String(seq.value).padStart(4, "0")}`;
}

/** 不带日期的编码，如 CUS0001 */
export async function nextCode(tx: DbClient, prefix: string, width = 4) {
  const seq = await tx.sequence.upsert({
    where: { key: prefix },
    create: { key: prefix, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}${String(seq.value).padStart(width, "0")}`;
}
