import type { FormField } from "@/lib/services/approval";

export const FIELD_TYPE_LABELS: Record<FormField["type"], string> = {
  text: "单行文本",
  textarea: "多行文本",
  number: "数字",
  date: "日期",
  select: "单选",
  user: "成员",
};

export type FormValues = Record<string, string>;

/** 按表单定义校验并规整数据：数字转为 number，其余为去空格的字符串，空值不写入 */
export function validateFormData(fields: FormField[], raw: Record<string, unknown>) {
  const data: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = raw[f.name];
    const s = v === undefined || v === null ? "" : String(v).trim();
    if (!s) {
      if (f.required) errors[f.name] = `请填写「${f.label}」`;
      continue;
    }
    if (f.type === "number") {
      const n = Number(s);
      if (!Number.isFinite(n)) errors[f.name] = `「${f.label}」必须是数字`;
      else if (n < 0) errors[f.name] = `「${f.label}」不能为负数`;
      else data[f.name] = n;
    } else if (f.type === "select") {
      if (f.options?.length && !f.options.includes(s)) errors[f.name] = `「${f.label}」的选项无效`;
      else data[f.name] = s;
    } else if (f.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[f.name] = `「${f.label}」日期格式不正确`;
      else data[f.name] = s;
    } else {
      data[f.name] = s.slice(0, f.type === "textarea" ? 5000 : 500);
    }
  }
  const start = data.startDate;
  const end = data.endDate;
  if (typeof start === "string" && typeof end === "string" && end < start && !errors.endDate) {
    const label = fields.find((f) => f.name === "endDate")?.label ?? "结束日期";
    errors.endDate = `「${label}」不能早于开始日期`;
  }
  return { data, errors };
}

export function toFormValues(data: Record<string, unknown>): FormValues {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));
}

export function parseFormData(json: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
