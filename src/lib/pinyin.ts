/**
 * 通讯录拼音分组：用 ICU 的 pinyin 排序规则（Intl.Collator zh-u-co-pinyin）给中文姓名定首字母，不打包拼音字典。
 * 每个字母取 pinyin 排序里该字母的第一个汉字作分界，汉字落在哪两个分界之间就属于哪个字母。
 */
const COLLATOR_LOCALE = "zh-Hans-CN-u-co-pinyin";

let collator: Intl.Collator | null = null;
function getCollator() {
  collator ??= new Intl.Collator(COLLATOR_LOCALE, { sensitivity: "base", numeric: true });
  return collator;
}

// pinyin 排序中各字母的第一个汉字（没有以 I、U、V 开头的普通话音节）
const BOUNDARIES: [letter: string, first: string][] = [
  ["A", "阿"],
  ["B", "八"],
  ["C", "嚓"],
  ["D", "哒"],
  ["E", "妸"],
  ["F", "发"],
  ["G", "旮"],
  ["H", "哈"],
  ["J", "讥"],
  ["K", "咔"],
  ["L", "垃"],
  ["M", "妈"],
  ["N", "拏"],
  ["O", "噢"],
  ["P", "妑"],
  ["Q", "七"],
  ["R", "呥"],
  ["S", "仨"],
  ["T", "他"],
  ["W", "屲"],
  ["X", "夕"],
  ["Y", "丫"],
  ["Z", "帀"],
];

// 常见多音字姓氏：排序规则按常用读音归类，作姓时读音不同
const SURNAME_INITIAL: Record<string, string> = {
  曾: "Z",
  单: "S",
  解: "X",
  仇: "Q",
  区: "O",
  查: "Z",
  朴: "P",
  繁: "P",
  覃: "Q",
  翟: "Z",
  秘: "B",
  缪: "M",
  员: "Y",
  尉: "Y",
  乐: "Y",
  召: "S",
  盖: "G",
  长: "C",
  重: "C",
  种: "C",
  沈: "S",
  柏: "B",
};

const CJK = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

export const INDEX_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"] as const;

/** 分组标题的锚点 id（# 不能直接用在 id 选择器里） */
export const letterAnchorId = (letter: string) => `contacts-letter-${letter === "#" ? "other" : letter}`;

/** 姓名首字母（A–Z）；数字、符号、表情及其他文字归入 # */
export function pinyinInitial(name: string): string {
  const first = [...name.trim().normalize("NFKC")][0];
  if (!first) return "#";
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  if (!CJK.test(first)) return "#";
  const surname = SURNAME_INITIAL[first];
  if (surname) return surname;
  const c = getCollator();
  // 排在「阿」之前的少数汉字（如「吖」）也读 a
  let letter = "A";
  for (const [l, b] of BOUNDARIES) {
    if (c.compare(first, b) >= 0) letter = l;
    else break;
  }
  return letter;
}

function letterRank(letter: string) {
  const i = INDEX_LETTERS.indexOf(letter as (typeof INDEX_LETTERS)[number]);
  return i < 0 ? INDEX_LETTERS.length : i;
}

/** 按首字母分组，组内按拼音排序；# 组排在最后 */
export function groupByPinyin<T>(items: T[], name: (item: T) => string): { letter: string; items: T[] }[] {
  const c = getCollator();
  const keyed = items.map((item) => ({ item, n: name(item).trim().normalize("NFKC"), letter: pinyinInitial(name(item)) }));
  keyed.sort((a, b) => letterRank(a.letter) - letterRank(b.letter) || c.compare(a.n, b.n));
  const groups: { letter: string; items: T[] }[] = [];
  for (const k of keyed) {
    const last = groups[groups.length - 1];
    if (last?.letter === k.letter) last.items.push(k.item);
    else groups.push({ letter: k.letter, items: [k.item] });
  }
  return groups;
}
