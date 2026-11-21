import type { z } from "zod";

/** zod 校验，失败时抛出第一条中文错误提示（交给 runAction 展示给用户） */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "输入内容不合法，请检查后重试");
  }
  return r.data;
}
