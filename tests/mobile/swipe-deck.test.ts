import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deckActiveIndex } from "@/lib/swipe-deck";

// 443px 视口：容器 443、左右各 16px 内边距，卡片宽 84% ≈ 358、间距 12 → step 370；三张卡片的最大滚动距离 = 3*358+2*12+32-443
const STEP = 370;
const MAX = 3 * 358 + 2 * 12 + 32 - 443;

describe("deckActiveIndex（手机工作台待办卡片）", () => {
  it("起点是第一张", () => {
    assert.equal(deckActiveIndex({ scrollLeft: 0, maxScroll: MAX, step: STEP, count: 3 }), 0);
  });

  it("按最近的吸附点取整", () => {
    assert.equal(deckActiveIndex({ scrollLeft: STEP * 0.4, maxScroll: MAX, step: STEP, count: 3 }), 0);
    assert.equal(deckActiveIndex({ scrollLeft: STEP * 0.6, maxScroll: MAX, step: STEP, count: 3 }), 1);
    assert.equal(deckActiveIndex({ scrollLeft: STEP, maxScroll: MAX, step: STEP, count: 3 }), 1);
  });

  it("滚到最右端算最后一张（最后一张对不齐起点）", () => {
    assert.ok(MAX < STEP * 2, "最后一张的起点超出最大滚动距离");
    assert.equal(deckActiveIndex({ scrollLeft: MAX, maxScroll: MAX, step: STEP, count: 3 }), 2);
    assert.equal(deckActiveIndex({ scrollLeft: MAX - 1, maxScroll: MAX, step: STEP, count: 3 }), 2);
  });

  it("越界与退化输入", () => {
    assert.equal(deckActiveIndex({ scrollLeft: -20, maxScroll: MAX, step: STEP, count: 3 }), 0);
    assert.equal(deckActiveIndex({ scrollLeft: 9999, maxScroll: 0, step: STEP, count: 3 }), 2);
    assert.equal(deckActiveIndex({ scrollLeft: 100, maxScroll: MAX, step: 0, count: 3 }), 0);
    assert.equal(deckActiveIndex({ scrollLeft: 100, maxScroll: 0, step: STEP, count: 1 }), 0);
    assert.equal(deckActiveIndex({ scrollLeft: 0, maxScroll: 0, step: STEP, count: 0 }), 0);
  });
});
