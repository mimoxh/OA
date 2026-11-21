import type { z } from "zod";

/** 校验输入，失败时抛出第一条中文错误信息（runAction 会原样提示给用户） */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "输入数据不合法");
  }
  return r.data;
}

/** 只保留调用方实际传入的字段（用于部分更新） */
export function pickProvided<T extends object>(data: T, input: object): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => k in input)) as Partial<T>;
}
