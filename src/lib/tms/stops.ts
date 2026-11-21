/** Route.stops 是 JSON 字符串数组 */
export function parseStops(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  } catch {
    return [];
  }
}

export function formatHours(h: number) {
  if (!h) return "—";
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  if (!whole) return `${min} 分钟`;
  return min ? `${whole} 小时 ${min} 分钟` : `${whole} 小时`;
}
