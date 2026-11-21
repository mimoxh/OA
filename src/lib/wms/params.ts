export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function str(v: string | string[] | undefined): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? "";
  return "";
}

export function pageNum(v: string | string[] | undefined): number {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 构造带查询参数的链接，空值会被忽略 */
export function withParams(path: string, params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}
