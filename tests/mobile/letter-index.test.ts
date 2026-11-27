import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { letterAt, letterTarget } from "@/lib/letter-index";
import { INDEX_LETTERS } from "@/lib/pinyin";

describe("letterAt（字母索引条：手指纵坐标 → 字母）", () => {
  const h = INDEX_LETTERS.length * 18;
  it("按等高格子换算", () => {
    assert.equal(letterAt(INDEX_LETTERS, 0, h), "A");
    assert.equal(letterAt(INDEX_LETTERS, 17.9, h), "A");
    assert.equal(letterAt(INDEX_LETTERS, 18, h), "B");
    assert.equal(letterAt(INDEX_LETTERS, 25 * 18 + 1, h), "Z");
    assert.equal(letterAt(INDEX_LETTERS, h - 1, h), "#");
  });

  it("滑出索引条上下两端时夹到首尾，不会跳空", () => {
    assert.equal(letterAt(INDEX_LETTERS, -40, h), "A");
    assert.equal(letterAt(INDEX_LETTERS, h + 200, h), "#");
  });

  it("没有尺寸或没有字母时返回 null", () => {
    assert.equal(letterAt(INDEX_LETTERS, 10, 0), null);
    assert.equal(letterAt([], 10, 100), null);
  });
});

describe("letterTarget（要跳到哪个分组）", () => {
  const available = ["C", "L", "W", "#"];
  it("字母本身有成员：就是它", () => {
    assert.equal(letterTarget(INDEX_LETTERS, available, "L"), "L");
    assert.equal(letterTarget(INDEX_LETTERS, available, "#"), "#");
  });

  it("没有成员：跳到其后最近的分组", () => {
    assert.equal(letterTarget(INDEX_LETTERS, available, "A"), "C");
    assert.equal(letterTarget(INDEX_LETTERS, available, "M"), "W");
    assert.equal(letterTarget(INDEX_LETTERS, available, "X"), "#");
  });

  it("其后都没有：退到其前最近的分组", () => {
    assert.equal(letterTarget(INDEX_LETTERS, ["C", "L"], "Z"), "L");
    assert.equal(letterTarget(INDEX_LETTERS, ["C", "L"], "#"), "L");
  });

  it("没有任何分组或未知字母：null", () => {
    assert.equal(letterTarget(INDEX_LETTERS, [], "A"), null);
    assert.equal(letterTarget(INDEX_LETTERS, available, "?"), null);
  });
});
