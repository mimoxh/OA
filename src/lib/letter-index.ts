/** 字母索引条：按手指纵坐标换算成第几个字母（越界时夹到首尾） */
export function letterAt(letters: readonly string[], offsetY: number, height: number): string | null {
  if (!letters.length || height <= 0) return null;
  const i = Math.floor((offsetY / height) * letters.length);
  return letters[Math.min(letters.length - 1, Math.max(0, i))];
}

/** 要跳转到的分组：字母本身有成员就是它，否则取其后最近的分组，再没有就取其前最近的分组 */
export function letterTarget(letters: readonly string[], available: Iterable<string>, letter: string): string | null {
  const has = new Set(available);
  if (has.has(letter)) return letter;
  const from = letters.indexOf(letter);
  if (from < 0) return null;
  return letters.slice(from + 1).find((l) => has.has(l)) ?? [...letters.slice(0, from)].reverse().find((l) => has.has(l)) ?? null;
}
