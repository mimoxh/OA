/**
 * 横向吸附卡片组（手机工作台的待办卡片）：按滚动位置算出当前卡片。
 * 卡片按起点吸附，但最后一张卡片比容器窄、对齐不到起点，滚到最右端时直接算最后一张。
 */
export function deckActiveIndex({
  scrollLeft,
  maxScroll,
  step,
  count,
}: {
  scrollLeft: number;
  maxScroll: number;
  /** 相邻两张卡片起点之间的距离（卡片宽 + 间距） */
  step: number;
  count: number;
}): number {
  if (count <= 1 || step <= 0) return 0;
  if (maxScroll > 0 && scrollLeft >= maxScroll - 2) return count - 1;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / step)));
}
