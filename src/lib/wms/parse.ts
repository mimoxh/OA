import type { z } from "zod";

/** 用 zod 校验输入，失败时抛出带首条中文提示的 Error（runAction 会原样展示给用户） */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "输入有误");
  return r.data;
}
