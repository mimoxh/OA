import type { z } from "zod";

/** zod 校验，失败时抛出首条中文提示（供 runAction 直接展示） */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(issue?.message && !/^Invalid|^Expected|^Too/.test(issue.message) ? issue.message : "提交的数据格式不正确");
  }
  return r.data;
}
